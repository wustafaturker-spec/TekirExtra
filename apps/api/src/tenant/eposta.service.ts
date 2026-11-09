import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { createTransport, type Transporter } from "nodemailer";
import { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { coz, sifrele } from "../core/kripto";
import { degisiklikleriBul } from "../core/denetim-farki";
import { anaMakineHatasi, guvenliAdresCoz } from "../core/guvenlik/dis-istek";
import { hataMetni, smtpHataSinifi } from "../ileti/ileti-kurallari";
import { PlatformIletiService } from "../ileti/platform-ileti.service";

/** SEC-03: kiracının sunucusuna yalnız posta portlarından bağlanılır (iç ağ port taraması olmasın). */
/** ILT-02: bu türler firmanın değil platformun hesabından çıkar; kullanıcı henüz firmaya bağlı olmayabilir. */
export const SISTEM_ILETI_TURLERI: ReadonlySet<string> = new Set(["dogrulama", "kullanici_davet", "parola_sifirlama", "eposta_degisimi"]);
/** Kısa süreli ağ hatasında aynı istek içinde yeniden deneme; ödeme sözü iletisi kendi tek gönderim kuralına tabidir. */
const TEKRAR_BEKLEMELERI_MS = [1_000, 3_000];
const TEKRARSIZ_TURLER: ReadonlySet<string> = new Set(["odeme_sozu_hatirlatma"]);
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const SMTP_PORTLARI = [25, 465, 587, 2525] as const;
export const IMAP_PORTLARI = [143, 993] as const;
const sunucuAdi = (v: string) => anaMakineHatasi(v) === null;

export const epostaAyarlariSemasi = z.object({
  host: z.string().trim().min(1).max(255).refine(sunucuAdi, { message: "SMTP sunucusu genel bir alan adı olmalı (IP, yerel ağ ya da dinamik DNS adresi kullanılamaz)" }),
  port: z.number().int().refine((p) => (SMTP_PORTLARI as readonly number[]).includes(p), { message: `SMTP portu ${SMTP_PORTLARI.join(", ")} olmalı` }),
  guvenlik: z.enum(["yok", "starttls", "ssl"]), kullaniciAdi: z.string().max(255).optional(), parola: z.string().max(500).optional(),
  gondericiAdi: z.string().min(1).max(120), gondericiEposta: z.email(), yanitAdresi: z.email().optional().or(z.literal("")),
  // IMAP (Gelen e-posta)
  imapHost: z.string().trim().max(255).refine(sunucuAdi, { message: "IMAP sunucusu genel bir alan adı olmalı (IP, yerel ağ ya da dinamik DNS adresi kullanılamaz)" }).optional().or(z.literal("")),
  imapPort: z.number().int().refine((p) => (IMAP_PORTLARI as readonly number[]).includes(p), { message: `IMAP portu ${IMAP_PORTLARI.join(", ")} olmalı` }).optional().default(993),
  imapGuvenlik: z.enum(["ssl", "starttls", "yok"]).optional().default("ssl"),
  imapKullaniciAdi: z.string().max(255).optional().or(z.literal("")),
  imapParola: z.string().max(500).optional().or(z.literal("")),
  imapKlasor: z.string().max(100).optional().default("INBOX"),
  imapAktif: z.boolean().optional().default(false),
});
type EpostaAyari = z.infer<typeof epostaAyarlariSemasi>;
export type SaklananAyar = Omit<EpostaAyari, "parola" | "imapParola"> & { sifreliParola?: string; imapSifreliParola?: string };

@Injectable()
export class EpostaService {
  private readonly logger = new Logger(EpostaService.name);
  constructor(private readonly prisma: PrismaService, private readonly ileti: PlatformIletiService) {}

  private baglam(): { tenantId: string } | null { try { return aktifBaglam(); } catch { return null; } }
  async saklananAyar(tenantId: string): Promise<SaklananAyar | null> {
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul: "eposta" } } }));
    return kayit?.ayarlar as SaklananAyar | null;
  }
  private async transporter(zamanAsimiMs?: number): Promise<{ transport: Transporter; from: string; replyTo?: string; gonderen: "firma" | "platform" }> {
    const sureler = zamanAsimiMs ? { connectionTimeout: zamanAsimiMs, greetingTimeout: zamanAsimiMs, socketTimeout: zamanAsimiMs } : {};
    const baglam = this.baglam(); const ayar = baglam ? await this.saklananAyar(baglam.tenantId) : null;
    if (!ayar) {
      // ILT-02: SMTP'si olmayan firma platform hesabından gönderir; yanıtlar firmanın e-postasına döner.
      const tasiyici = await this.ileti.tasiyici(zamanAsimiMs);
      const firmaEpostasi = baglam ? (await this.prisma.tenantIslem(baglam.tenantId, (tx) => tx.tenant.findUnique({ where: { id: baglam.tenantId }, select: { eposta: true } })))?.eposta : null;
      return { ...tasiyici, replyTo: firmaEpostasi ?? tasiyici.replyTo, gonderen: "platform" };
    }
    const parola = ayar.sifreliParola ? coz(ayar.sifreliParola) : undefined;
    // SEC-03: ad bağlantıdan önce çözülür, özel IP reddedilir ve bağlantı o IP'ye sabitlenir; sertifika asıl adla doğrulanır.
    const { ip, servername } = await guvenliAdresCoz(ayar.host);
    return { gonderen: "firma", transport: createTransport({ ...sureler, host: ip, tls: { servername }, port: ayar.port, secure: ayar.guvenlik === "ssl", requireTLS: ayar.guvenlik === "starttls", auth: ayar.kullaniciAdi ? { user: ayar.kullaniciAdi, pass: parola ?? "" } : undefined }), from: `"${ayar.gondericiAdi.replaceAll('"', "")}" <${ayar.gondericiEposta}>`, replyTo: ayar.yanitAdresi || undefined };
  }
  private async kaydet(alici: string, konu: string, tur: string, durum: string, ekSayisi: number, ek: { hata?: unknown; gonderen?: "firma" | "platform"; deneme?: number; saglayiciNo?: string | null; kayitId?: string } = {}) {
    const baglam = this.baglam(); if (!baglam) return;
    const hataMesaji = ek.hata ? hataMetni(ek.hata).slice(0, 1000) : null;
    const sonuc = { durum, hataMesaji, gonderen: ek.gonderen ?? "firma", deneme: ek.deneme ?? 1, saglayiciNo: ek.saglayiciNo ?? null };
    // ILT-05: kesin başarısızlıkta anahtar bırakılır ki çağıran yeniden deneyebilsin; belirsiz sonuçta kalır, tekrar çıkmaz.
    await this.prisma.tenantIslem(baglam.tenantId, (tx) => ek.kayitId
      ? tx.epostaGonderim.update({ where: { id: ek.kayitId }, data: { ...sonuc, ...(durum === "basarisiz" ? { anahtar: null } : {}) } })
      : tx.epostaGonderim.create({ data: { tenantId: baglam.tenantId, alici, konu, tur, ekSayisi, ...sonuc } })).catch(() => undefined);
  }
  /** ILT-05: gönderimden önce anahtarı ayırır; anahtar kullanılmışsa null döner. Yarıda kalan süreç de tekrar göndermez. */
  private async anahtarAyir(anahtar: string, g: { alici: string; konu: string; tur: string; ekSayisi: number }): Promise<string | null | undefined> {
    const baglam = this.baglam(); if (!baglam) return undefined;
    try {
      const kayit = await this.prisma.tenantIslem(baglam.tenantId, (tx) => tx.epostaGonderim.create({ data: { tenantId: baglam.tenantId, ...g, anahtar: createHash("sha256").update(anahtar).digest("hex"), durum: "gonderiliyor", deneme: 0 }, select: { id: true } }));
      return kayit.id;
    } catch (hata) {
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") return null;
      throw hata;
    }
  }
  /** AI-38: dönen `messageId` gelen yanıtı (In-Reply-To) gönderilen belgeye bağlar. */
  private async gonder(girdi: { alici: string; konu: string; metin: string; html?: string; tur?: string; ekler?: { dosyaAdi: string; icerik: Buffer; mime: string }[]; inReplyTo?: string; references?: string[]; messageId?: string; anahtar?: string }): Promise<{ messageId: string | null }> {
    const tur = girdi.tur ?? "genel", ekSayisi = girdi.ekler?.length ?? 0;
    if (SISTEM_ILETI_TURLERI.has(tur)) {
      await this.ileti.gonder({ tur, alicilar: [girdi.alici], konu: girdi.konu, metin: girdi.metin, html: girdi.html, tenantId: this.baglam()?.tenantId ?? null });
      return { messageId: null };
    }
    const kayitId = girdi.anahtar ? await this.anahtarAyir(girdi.anahtar, { alici: girdi.alici, konu: girdi.konu, tur, ekSayisi }) : undefined;
    if (kayitId === null) return { messageId: null };
    let gonderen: "firma" | "platform" = "firma", deneme = 0;
    try {
      const { transport, from, replyTo, gonderen: kaynak } = await this.transporter(tur === "odeme_sozu_hatirlatma" ? 60_000 : undefined);
      gonderen = kaynak;
      for (;;) {
        deneme += 1;
        try {
          const bilgi = await transport.sendMail({ from, replyTo, to: girdi.alici, subject: girdi.konu, text: girdi.metin, html: girdi.html, messageId: girdi.messageId, inReplyTo: girdi.inReplyTo, references: girdi.references, attachments: girdi.ekler?.map((e) => ({ filename: e.dosyaAdi, content: e.icerik, contentType: e.mime })) });
          const messageId = (bilgi as { messageId?: string }).messageId ?? null;
          await this.kaydet(girdi.alici, girdi.konu, tur, "gonderildi", ekSayisi, { gonderen, deneme, saglayiciNo: messageId, kayitId });
          return { messageId };
        } catch (hata) {
          const bekleme = TEKRAR_BEKLEMELERI_MS[deneme - 1];
          if (bekleme === undefined || TEKRARSIZ_TURLER.has(tur) || smtpHataSinifi(hata) !== "gecici") throw hata;
          await bekle(bekleme);
        }
      }
    } catch (hata) {
      // ILT-02: firma SMTP'si hata verirse ileti sessizce platforma aktarılmaz.
      await this.kaydet(girdi.alici, girdi.konu, tur, smtpHataSinifi(hata) === "belirsiz" ? "belirsiz" : "basarisiz", ekSayisi, { hata, gonderen, deneme: Math.max(1, deneme), kayitId });
      throw hata;
    }
  }
  async ayarlariGetir() {
    const { tenantId } = aktifBaglam();
    const a = await this.saklananAyar(tenantId);
    return a
      ? {
          ...a,
          sifreliParola: undefined,
          imapSifreliParola: undefined,
          parolaKayitli: Boolean(a.sifreliParola),
          yapilandirildi: Boolean(a.host && a.gondericiEposta),
          imapParolaKayitli: Boolean(a.imapSifreliParola),
          imapYapilandirildi: Boolean(a.imapHost && a.imapKullaniciAdi && a.imapSifreliParola),
        }
      : {
          host: "",
          port: 587,
          guvenlik: "starttls" as const,
          kullaniciAdi: "",
          gondericiAdi: "",
          gondericiEposta: "",
          yanitAdresi: "",
          parolaKayitli: false,
          yapilandirildi: false,
          imapHost: "",
          imapPort: 993,
          imapGuvenlik: "ssl" as const,
          imapKullaniciAdi: "",
          imapKlasor: "INBOX",
          imapAktif: false,
          imapParolaKayitli: false,
          imapYapilandirildi: false,
        };
  }
  async ayarlariGuncelle(girdi: EpostaAyari) {
    const { tenantId } = aktifBaglam();
    const mevcut = await this.saklananAyar(tenantId);
    const saklanan: SaklananAyar = {
      host: girdi.host,
      port: girdi.port,
      guvenlik: girdi.guvenlik,
      kullaniciAdi: girdi.kullaniciAdi,
      gondericiAdi: girdi.gondericiAdi,
      gondericiEposta: girdi.gondericiEposta,
      yanitAdresi: girdi.yanitAdresi,
      sifreliParola: girdi.parola ? sifrele(girdi.parola) : mevcut?.sifreliParola,
      imapHost: girdi.imapHost || undefined,
      imapPort: girdi.imapPort ?? 993,
      imapGuvenlik: girdi.imapGuvenlik ?? "ssl",
      imapKullaniciAdi: girdi.imapKullaniciAdi || undefined,
      imapKlasor: girdi.imapKlasor || "INBOX",
      imapAktif: Boolean(girdi.imapAktif),
      imapSifreliParola: girdi.imapParola ? sifrele(girdi.imapParola) : mevcut?.imapSifreliParola,
    };
    if (saklanan.kullaniciAdi && !saklanan.sifreliParola) throw new BadRequestException("SMTP parolası zorunludur");
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.modulAyar.upsert({ where: { tenantId_modul: { tenantId, modul: "eposta" } }, create: { tenantId, modul: "eposta", ayarlar: saklanan }, update: { ayarlar: saklanan } });
      // Yönetim P1-4: SMTP/IMAP ayarı değişikliği; parolalar yalnız "değişti" olarak yazılır.
      const degisiklikler = degisiklikleriBul(mevcut ?? {}, saklanan, { gizli: ["kullaniciAdi", "imapKullaniciAdi"] });
      if (Object.keys(degisiklikler).length) await tx.auditLog.create({ data: { tenantId, userId: aktifBaglam().userId, islem: "eposta_ayari_degisti", varlik: "modul_ayar", detay: { degisiklikler } as Prisma.InputJsonValue } });
    });
    return this.ayarlariGetir();
  }
  async baglantiTest(alici: string) { const { transport, from, replyTo } = await this.transporter(); try { await transport.verify(); await transport.sendMail({ from, replyTo, to: alici, subject: "TekirExtra e-posta bağlantı testi", text: "SMTP bağlantınız başarıyla yapılandırıldı. Bu ileti TekirExtra test ekranından gönderilmiştir." }); await this.kaydet(alici, "TekirExtra e-posta bağlantı testi", "test", "gonderildi", 0); return { basarili: true, mesaj: `Test e-postası ${alici} adresine gönderildi` }; } catch (hata) { await this.kaydet(alici, "TekirExtra e-posta bağlantı testi", "test", "basarisiz", 0, { hata }); throw new BadRequestException(hata instanceof Error ? `SMTP bağlantısı başarısız: ${hata.message}` : "SMTP bağlantısı başarısız"); } }
  async imapBaglantiTest() {
    const { tenantId } = aktifBaglam();
    const ayar = await this.saklananAyar(tenantId);
    if (!ayar?.imapHost || !ayar?.imapKullaniciAdi || !ayar?.imapSifreliParola) {
      throw new BadRequestException("IMAP sunucu bilgileri eksik veya parola girilmemiş");
    }
    const parola = coz(ayar.imapSifreliParola);
    const { ImapFlow } = await import("imapflow");
    const sunucu = await guvenliAdresCoz(ayar.imapHost).catch((h: unknown) => { throw new BadRequestException(h instanceof Error ? h.message : "IMAP sunucusu kullanılamaz"); });
    const client = new ImapFlow({
      host: sunucu.ip,
      servername: sunucu.servername,
      port: ayar.imapPort ?? 993,
      secure: (ayar.imapGuvenlik ?? "ssl") === "ssl",
      auth: { user: ayar.imapKullaniciAdi, pass: parola },
      logger: false,
    });
    try {
      await client.connect();
      const lock = await client.getMailboxLock(ayar.imapKlasor || "INBOX");
      let mesajSayisi = 0;
      try {
        mesajSayisi = client.mailbox ? (client.mailbox.exists ?? 0) : 0;
      } finally {
        lock.release();
      }
      await client.logout();
      return { basarili: true, mesaj: `IMAP bağlantısı başarılı! '${ayar.imapKlasor || "INBOX"}' klasöründe ${mesajSayisi} ileti bulundu.` };
    } catch (hata) {
      throw new BadRequestException(hata instanceof Error ? `IMAP bağlantısı başarısız: ${hata.message}` : "IMAP bağlantısı başarısız");
    }
  }
  /** ILT-07: firmanın gönderimleri; ileti gövdesi kayıtlı değildir. */
  async gonderimler(g: { durum?: string; tur?: string; baslangic?: string; bitis?: string; sayfa?: number }) {
    const { tenantId } = aktifBaglam();
    const take = 50, sayfa = Math.max(1, g.sayfa ?? 1);
    const where: Prisma.EpostaGonderimWhereInput = { ...(g.durum ? { durum: g.durum } : {}), ...(g.tur ? { tur: g.tur } : {}), ...(g.baslangic || g.bitis ? { createdAt: { ...(g.baslangic ? { gte: new Date(`${g.baslangic}T00:00:00+03:00`) } : {}), ...(g.bitis ? { lte: new Date(`${g.bitis}T23:59:59.999+03:00`) } : {}) } } : {}) };
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [satirlar, toplam, turler] = await Promise.all([
        tx.epostaGonderim.findMany({ where, orderBy: { createdAt: "desc" }, skip: (sayfa - 1) * take, take }),
        tx.epostaGonderim.count({ where }),
        tx.epostaGonderim.findMany({ distinct: ["tur"], select: { tur: true }, orderBy: { tur: "asc" } }),
      ]);
      return { satirlar, toplam, sayfa, sayfaBoyutu: take, turler: turler.map((t) => t.tur) };
    });
  }
  async gecmis(adet = 50) { const { tenantId } = aktifBaglam(); return this.prisma.tenantIslem(tenantId, (tx) => tx.epostaGonderim.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(adet, 100) })); }
  dogrulamaGonder(eposta: string, adSoyad: string, link: string) { return this.gonder({ alici: eposta, konu: "TekirExtra — e-posta adresinizi doğrulayın", tur: "dogrulama", metin: `Merhaba ${adSoyad},\n\nTekirExtra kaydınızı tamamlamak için e-posta adresinizi doğrulayın:\n${link}\n\nBu link 24 saat geçerlidir.`, html: `<p>Merhaba ${adSoyad},</p><p><a href="${link}">E-postamı doğrula</a></p>` }); }
  /** Yönetim P2-3: yöneticinin açtığı hesaba "parolanı belirle" daveti. */
  kullaniciDavetGonder(eposta: string, adSoyad: string, firma: string, link: string, gun: number) { return this.gonder({ alici: eposta, konu: `${firma} sizi TekirExtra'ya davet etti`, tur: "kullanici_davet", metin: `Merhaba ${adSoyad},\n\n${firma} sizin için bir TekirExtra hesabı açtı. Parolanızı belirleyip giriş yapmak için:\n${link}\n\nBağlantı ${gun} gün geçerlidir ve bir kez kullanılabilir. Giriş adınız: ${eposta}`, html: `<p>Merhaba ${adSoyad},</p><p>${firma} sizin için bir TekirExtra hesabı açtı.</p><p><a href="${link}">Parolamı belirle</a></p><p>Bağlantı ${gun} gün geçerlidir ve bir kez kullanılabilir. Giriş adınız: ${eposta}</p>` }); }
  /** KLN-12: "Şifremi unuttum" bağlantısı. */
  parolaSifirlamaGonder(eposta: string, adSoyad: string, link: string, dakika: number) { return this.gonder({ alici: eposta, konu: "TekirExtra — parola sıfırlama", tur: "parola_sifirlama", metin: `Merhaba ${adSoyad},\n\nTekirExtra hesabınız için parola sıfırlama istendi. Yeni parola belirlemek için:\n${link}\n\nBağlantı ${dakika} dakika geçerlidir ve bir kez kullanılabilir. Bu isteği siz yapmadıysanız e-postayı yok sayın; parolanız değişmez.`, html: `<p>Merhaba ${adSoyad},</p><p>TekirExtra hesabınız için parola sıfırlama istendi.</p><p><a href="${link}">Yeni parola belirle</a></p><p>Bağlantı ${dakika} dakika geçerlidir ve bir kez kullanılabilir. Bu isteği siz yapmadıysanız e-postayı yok sayın; parolanız değişmez.</p>` }); }
  /** KLN-23: yeni adrese giriş adı değişikliği doğrulama bağlantısı. */
  epostaDegisimiDogrulamaGonder(yeniEposta: string, adSoyad: string, link: string, saat: number) { return this.gonder({ alici: yeniEposta, konu: "TekirExtra — yeni e-posta adresinizi doğrulayın", tur: "eposta_degisimi", metin: `Merhaba ${adSoyad},\n\nTekirExtra hesabınızın giriş e-postası bu adresle değiştirilmek isteniyor. Onaylamak için:\n${link}\n\nBağlantı ${saat} saat geçerlidir ve bir kez kullanılabilir. Onaylayana kadar eski adresinizle giriş yapmaya devam edersiniz.`, html: `<p>Merhaba ${adSoyad},</p><p>TekirExtra hesabınızın giriş e-postası bu adresle değiştirilmek isteniyor.</p><p><a href="${link}">Yeni adresimi onayla</a></p><p>Bağlantı ${saat} saat geçerlidir ve bir kez kullanılabilir. Onaylayana kadar eski adresinizle giriş yapmaya devam edersiniz.</p>` }); }
  /** KLN-23: eski adrese bilgilendirme; değişikliği kendisi istemediyse yöneticisine haber verir. */
  epostaDegisimiBilgilendir(eskiEposta: string, adSoyad: string, yeniEposta: string) { return this.gonder({ alici: eskiEposta, konu: "TekirExtra — giriş e-postanız değiştiriliyor", tur: "eposta_degisimi", metin: `Merhaba ${adSoyad},\n\nTekirExtra hesabınızın giriş e-postasının ${yeniEposta} olarak değiştirilmesi istendi. Yeni adresteki bağlantı onaylanınca bu adresle giriş yapılamaz.\n\nBu isteği siz ya da firma yöneticiniz yapmadıysanız hemen yöneticinize haber verin.`, html: `<p>Merhaba ${adSoyad},</p><p>TekirExtra hesabınızın giriş e-postasının <strong>${yeniEposta}</strong> olarak değiştirilmesi istendi. Yeni adresteki bağlantı onaylanınca bu adresle giriş yapılamaz.</p><p>Bu isteği siz ya da firma yöneticiniz yapmadıysanız hemen yöneticinize haber verin.</p>` }); }
  /** Ödeme sözü günü gönderimi: sabit Message-ID, ayrı geçmiş türü. */
  odemeSozuHatirlat(girdi: { alici: string; konu: string; metin: string; messageId: string }) { return this.gonder({ ...girdi, tur: "odeme_sozu_hatirlatma" }); }
  iletiGonder(girdi: { alici: string; konu: string; metin: string; html?: string; anahtar?: string }) { return this.gonder(girdi); }
  /** E-posta ekranından yazılan ileti; yanıtta In-Reply-To/References zinciri korur. */
  serbestIletiGonder(girdi: { alici: string; konu: string; metin: string; inReplyTo?: string; references?: string[] }) { return this.gonder({ ...girdi, tur: "ileti" }); }
  /** Kiracının kendi adresleri (gönderici + IMAP kullanıcısı); "Tümünü Yanıtla"da alıcılardan düşülür. */
  async kendiAdresleri(tenantId: string): Promise<string[]> { const a = await this.saklananAyar(tenantId); return [a?.gondericiEposta, a?.imapKullaniciAdi].filter((x): x is string => Boolean(x && x.includes("@"))).map((x) => x.toLowerCase()); }
  ekliIletiGonder(girdi: { alici: string; konu: string; metin: string; html?: string; ekler: { dosyaAdi: string; icerik: Buffer; mime: string }[] }) { return this.gonder({ ...girdi, tur: "belge" }); }
  /** RPR-24: zamanlanmış rapor; gönderim geçmişinde "rapor" türüyle ayrılır. */
  raporGonder(girdi: { alici: string; konu: string; metin: string; ekler: { dosyaAdi: string; icerik: Buffer; mime: string }[]; anahtar?: string }) { return this.gonder({ ...girdi, tur: "rapor" }); }
}
