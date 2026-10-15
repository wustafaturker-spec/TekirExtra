import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { coz, sifrele } from "../core/kripto";

export const epostaAyarlariSemasi = z.object({
  host: z.string().min(1).max(255), port: z.number().int().min(1).max(65535),
  guvenlik: z.enum(["yok", "starttls", "ssl"]), kullaniciAdi: z.string().max(255).optional(), parola: z.string().max(500).optional(),
  gondericiAdi: z.string().min(1).max(120), gondericiEposta: z.email(), yanitAdresi: z.email().optional().or(z.literal("")),
  // IMAP (Gelen e-posta)
  imapHost: z.string().max(255).optional().or(z.literal("")),
  imapPort: z.number().int().min(1).max(65535).optional().default(993),
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
  constructor(private readonly prisma: PrismaService) {}

  private baglam(): { tenantId: string } | null { try { return aktifBaglam(); } catch { return null; } }
  async saklananAyar(tenantId: string): Promise<SaklananAyar | null> {
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul: "eposta" } } }));
    return kayit?.ayarlar as SaklananAyar | null;
  }
  private async transporter(): Promise<{ transport: Transporter; from: string; replyTo?: string }> {
    const baglam = this.baglam(); const ayar = baglam ? await this.saklananAyar(baglam.tenantId) : null;
    if (!ayar) return { transport: createTransport({ host: process.env.SMTP_HOST ?? "localhost", port: Number(process.env.SMTP_PORT ?? 1025), secure: false }), from: process.env.MAIL_FROM ?? "TekirExtra <no-reply@tekirextra.local>" };
    const parola = ayar.sifreliParola ? coz(ayar.sifreliParola) : undefined;
    return { transport: createTransport({ host: ayar.host, port: ayar.port, secure: ayar.guvenlik === "ssl", requireTLS: ayar.guvenlik === "starttls", auth: ayar.kullaniciAdi ? { user: ayar.kullaniciAdi, pass: parola ?? "" } : undefined }), from: `"${ayar.gondericiAdi.replaceAll('"', "")}" <${ayar.gondericiEposta}>`, replyTo: ayar.yanitAdresi || undefined };
  }
  private async kaydet(alici: string, konu: string, tur: string, durum: string, ekSayisi: number, hata?: unknown) {
    const baglam = this.baglam(); if (!baglam) return;
    const hataMesaji = hata instanceof Error ? hata.message.slice(0, 1000) : hata ? String(hata).slice(0, 1000) : null;
    await this.prisma.tenantIslem(baglam.tenantId, (tx) => tx.epostaGonderim.create({ data: { tenantId: baglam.tenantId, alici, konu, tur, durum, ekSayisi, hataMesaji } })).catch(() => undefined);
  }
  private async gonder(girdi: { alici: string; konu: string; metin: string; html?: string; tur?: string; ekler?: { dosyaAdi: string; icerik: Buffer; mime: string }[] }) {
    try { const { transport, from, replyTo } = await this.transporter(); await transport.sendMail({ from, replyTo, to: girdi.alici, subject: girdi.konu, text: girdi.metin, html: girdi.html, attachments: girdi.ekler?.map((e) => ({ filename: e.dosyaAdi, content: e.icerik, contentType: e.mime })) }); await this.kaydet(girdi.alici, girdi.konu, girdi.tur ?? "genel", "gonderildi", girdi.ekler?.length ?? 0); this.logger.log(`E-posta gönderildi: ${girdi.alici} (${girdi.konu})`); }
    catch (hata) { await this.kaydet(girdi.alici, girdi.konu, girdi.tur ?? "genel", "basarisiz", girdi.ekler?.length ?? 0, hata); throw hata; }
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
    await this.prisma.tenantIslem(tenantId, (tx) => tx.modulAyar.upsert({ where: { tenantId_modul: { tenantId, modul: "eposta" } }, create: { tenantId, modul: "eposta", ayarlar: saklanan }, update: { ayarlar: saklanan } }));
    return this.ayarlariGetir();
  }
  async baglantiTest(alici: string) { const { transport, from, replyTo } = await this.transporter(); try { await transport.verify(); await transport.sendMail({ from, replyTo, to: alici, subject: "TekirExtra e-posta bağlantı testi", text: "SMTP bağlantınız başarıyla yapılandırıldı. Bu ileti TekirExtra test ekranından gönderilmiştir." }); await this.kaydet(alici, "TekirExtra e-posta bağlantı testi", "test", "gonderildi", 0); return { basarili: true, mesaj: `Test e-postası ${alici} adresine gönderildi` }; } catch (hata) { await this.kaydet(alici, "TekirExtra e-posta bağlantı testi", "test", "basarisiz", 0, hata); throw new BadRequestException(hata instanceof Error ? `SMTP bağlantısı başarısız: ${hata.message}` : "SMTP bağlantısı başarısız"); } }
  async imapBaglantiTest() {
    const { tenantId } = aktifBaglam();
    const ayar = await this.saklananAyar(tenantId);
    if (!ayar?.imapHost || !ayar?.imapKullaniciAdi || !ayar?.imapSifreliParola) {
      throw new BadRequestException("IMAP sunucu bilgileri eksik veya parola girilmemiş");
    }
    const parola = coz(ayar.imapSifreliParola);
    const { ImapFlow } = await import("imapflow");
    const client = new ImapFlow({
      host: ayar.imapHost,
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
  async gecmis(adet = 50) { const { tenantId } = aktifBaglam(); return this.prisma.tenantIslem(tenantId, (tx) => tx.epostaGonderim.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(adet, 100) })); }
  dogrulamaGonder(eposta: string, adSoyad: string, link: string) { return this.gonder({ alici: eposta, konu: "TekirExtra — e-posta adresinizi doğrulayın", tur: "dogrulama", metin: `Merhaba ${adSoyad},\n\nTekirExtra kaydınızı tamamlamak için e-posta adresinizi doğrulayın:\n${link}\n\nBu link 24 saat geçerlidir.`, html: `<p>Merhaba ${adSoyad},</p><p><a href="${link}">E-postamı doğrula</a></p>` }); }
  iletiGonder(girdi: { alici: string; konu: string; metin: string; html?: string }) { return this.gonder(girdi); }
  ekliIletiGonder(girdi: { alici: string; konu: string; metin: string; html?: string; ekler: { dosyaAdi: string; icerik: Buffer; mime: string }[] }) { return this.gonder({ ...girdi, tur: "belge" }); }
  /** RPR-24: zamanlanmış rapor; gönderim geçmişinde "rapor" türüyle ayrılır. */
  raporGonder(girdi: { alici: string; konu: string; metin: string; ekler: { dosyaAdi: string; icerik: Buffer; mime: string }[] }) { return this.gonder({ ...girdi, tur: "rapor" }); }
}
