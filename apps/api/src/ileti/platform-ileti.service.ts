import { ConflictException, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Job, Queue, UnrecoverableError, Worker } from "bullmq";
import { createHash } from "node:crypto";
import { createTransport, type Transporter } from "nodemailer";
import { z } from "zod";
import { aktifPlatformBaglam } from "../core/istek-baglami";
import { coz, sifrele } from "../core/kripto";
import { anaMakineHatasi, guvenliAdresCoz } from "../core/guvenlik/dis-istek";
import { redisBaglantisi } from "../core/redis-baglantisi";
import { PlatformPrismaService } from "../mevzuat/platform-prisma.service";
import { SmsReddedildi } from "../pos/netgsm.adapter";
import { hataMetni, smtpHataSinifi, type IletiOzeti } from "./ileti-kurallari";
import { telefonE164 } from "./sms-kurallari";
import { smsSaglayiciAl } from "./sms.service";

const KUYRUK_ADI = "tekirextra-ileti";
const DENEME_SAYISI = 5;
const ILK_BEKLEME_MS = 60_000;
/** Başarısız iş bu süre kuyrukta durur; gövde veritabanında olmadığı için yeniden gönderme bunu kullanır. */
const BASARISIZ_SAKLAMA_SN = 7 * 24 * 60 * 60;

export const SMTP_PORTLARI = [25, 465, 587, 2525] as const;

export const platformIletiAyariSemasi = z.object({
  host: z.string().trim().min(1).max(255).refine((v) => anaMakineHatasi(v) === null, { message: "SMTP sunucusu genel bir alan adı olmalıdır" }),
  port: z.number().int().refine((p) => (SMTP_PORTLARI as readonly number[]).includes(p), { message: `Port ${SMTP_PORTLARI.join(", ")} olmalıdır` }),
  guvenlik: z.enum(["yok", "starttls", "ssl"]),
  kullaniciAdi: z.string().trim().max(255).optional().or(z.literal("")),
  parola: z.string().max(500).optional().or(z.literal("")),
  gondericiAdi: z.string().trim().min(1).max(120),
  gondericiEposta: z.email(),
  yanitAdresi: z.email().optional().or(z.literal("")),
});

export const platformSmsAyariSemasi = z.object({
  kullaniciAdi: z.string().trim().min(1).max(100),
  parola: z.string().max(200).optional().or(z.literal("")),
  gondericiAdi: z.string().trim().min(1).max(20),
});

export interface IletiGirdisi {
  /** ör. "platform_davet", "abonelik_odeme" */
  tur: string;
  alicilar: string[];
  konu: string;
  metin: string;
  html?: string;
  /** ILT-05: verilirse aynı anahtarla ikinci ileti çıkmaz. */
  anahtar?: string;
  tenantId?: string | null;
}

export interface FirmaIletiSayisi { tenantId: string; firma: string; sistemToplam: number; sistemHata: number; epostaToplam: number; epostaHata: number; smsToplam: number; smsHata: number }
interface IsVerisi extends Omit<IletiGirdisi, "anahtar"> { kayitId: string }
export class IletiGonderilemedi extends Error {}

const ozet = (a: string) => createHash("sha256").update(a).digest("hex");
const metinGuvenli = (v: string) => v.replaceAll('"', "");

/**
 * ILT-01…06: platform iletilerinin tek çıkışı. `gonder` tek denemedir ve sonucu çağırana
 * bildirir (davet bağlantısı, tarama temelli hatırlatmalar: tarama zaten yeniden dener).
 * `kuyruga` kendi tekrarı olmayan iletiler içindir; worker artan aralıkla yeniden dener.
 */
@Injectable()
export class PlatformIletiService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformIletiService.name);
  private kuyrukNesnesi?: Queue;
  private isci?: Worker;

  constructor(private readonly platform: PlatformPrismaService) {}

  private get kuyrukEtkin() { return Boolean(process.env.REDIS_URL) && process.env.NODE_ENV !== "test"; }
  private get kayitEtkin() { return Boolean(process.env.DATABASE_URL_PLATFORM); }
  private get kuyruk() { return (this.kuyrukNesnesi ??= new Queue(KUYRUK_ADI, { connection: redisBaglantisi() })); }

  onModuleInit(): void {
    if (process.env.TEKIR_WORKER !== "1" || !this.kuyrukEtkin) return;
    this.isci = new Worker(KUYRUK_ADI, (is: Job<IsVerisi>) => this.isle(is), { connection: redisBaglantisi(), concurrency: 3 });
    this.isci.on("error", (h) => this.logger.error(JSON.stringify({ event: "ileti_worker_error", error: h.message })));
  }

  async onModuleDestroy(): Promise<void> {
    await this.isci?.close();
    await this.kuyrukNesnesi?.close();
  }

  /** ILT-02: platform hesabının bağlantısı; firmanın SMTP'si olmayan belge iletileri de bunu kullanır. */
  async tasiyici(zamanAsimiMs?: number): Promise<{ transport: Transporter; from: string; replyTo?: string }> {
    const sureler = zamanAsimiMs ? { connectionTimeout: zamanAsimiMs, greetingTimeout: zamanAsimiMs, socketTimeout: zamanAsimiMs } : {};
    const ayar = this.kayitEtkin ? await this.platform.db.platformIletiAyari.findUnique({ where: { id: 1 } }) : null;
    if (!ayar) return { transport: createTransport({ ...sureler, host: process.env.SMTP_HOST ?? "localhost", port: Number(process.env.SMTP_PORT ?? 1025), secure: false }), from: process.env.MAIL_FROM ?? "TekirExtra <no-reply@tekirextra.local>" };
    const { ip, servername } = await guvenliAdresCoz(ayar.host);
    return {
      transport: createTransport({ ...sureler, host: ip, tls: { servername }, port: ayar.port, secure: ayar.guvenlik === "ssl", requireTLS: ayar.guvenlik === "starttls", auth: ayar.kullaniciAdi ? { user: ayar.kullaniciAdi, pass: ayar.sifreliParola ? coz(ayar.sifreliParola) : "" } : undefined }),
      from: `"${metinGuvenli(ayar.gondericiAdi)}" <${ayar.gondericiEposta}>`,
      replyTo: ayar.yanitAdresi ?? undefined,
    };
  }

  private async ilet(g: Pick<IletiGirdisi, "alicilar" | "konu" | "metin" | "html">): Promise<string | null> {
    const { transport, from, replyTo } = await this.tasiyici();
    const bilgi = await transport.sendMail({ from, replyTo, to: g.alicilar.join(", "), subject: g.konu, text: g.metin, html: g.html });
    return (bilgi as { messageId?: string }).messageId ?? null;
  }

  /** ILT-05: anahtar daha önce kullanıldıysa null döner. */
  private async kayitAc(g: Pick<IletiGirdisi, "anahtar" | "tur" | "tenantId" | "alicilar" | "konu">, kanal = "eposta"): Promise<string | null> {
    if (!this.kayitEtkin) return "kayitsiz";
    try {
      const k = await this.platform.db.platformIletiKaydi.create({ data: { kanal, anahtar: g.anahtar ? ozet(g.anahtar) : null, tur: g.tur, tenantId: g.tenantId ?? null, alicilar: g.alicilar.join(", "), konu: g.konu, durum: "kuyrukta" }, select: { id: true } });
      return k.id;
    } catch (hata) {
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") return null;
      throw hata;
    }
  }

  private async kayitGuncelle(id: string, data: Prisma.PlatformIletiKaydiUpdateInput) {
    if (id !== "kayitsiz") await this.platform.db.platformIletiKaydi.update({ where: { id }, data });
  }

  /** Tek deneme. Başarısızsa `IletiGonderilemedi` atar; kayıtta iz kalır. */
  async gonder(g: IletiGirdisi): Promise<{ gonderildi: boolean }> {
    if (!g.alicilar.length) return { gonderildi: false };
    const id = await this.kayitAc(g);
    if (id === null) return { gonderildi: false };
    try {
      const no = await this.ilet(g);
      await this.kayitGuncelle(id, { durum: "gonderildi", deneme: 1, saglayiciNo: no, gonderildiAt: new Date(), hata: null });
      return { gonderildi: true };
    } catch (hata) {
      await this.kayitGuncelle(id, { durum: smtpHataSinifi(hata) === "belirsiz" ? "belirsiz" : "basarisiz", deneme: 1, hata: hataMetni(hata) });
      throw new IletiGonderilemedi(hataMetni(hata));
    }
  }

  /** Worker yeniden dener. Kuyruk yoksa (Redis tanımsız) tek deneme yapılır. */
  async kuyruga(g: IletiGirdisi): Promise<void> {
    if (!g.alicilar.length) return;
    if (!this.kuyrukEtkin) { await this.gonder(g); return; }
    const kayitId = await this.kayitAc(g);
    if (kayitId === null) return;
    const { anahtar: _a, ...veri } = g;
    await this.kuyruk.add("gonder", { ...veri, kayitId } satisfies IsVerisi, {
      jobId: kayitId, attempts: DENEME_SAYISI, backoff: { type: "exponential", delay: ILK_BEKLEME_MS },
      removeOnComplete: true, removeOnFail: { age: BASARISIZ_SAKLAMA_SN },
    });
  }

  private async isle(is: Job<IsVerisi>): Promise<void> {
    const { kayitId, ...g } = is.data;
    const deneme = is.attemptsMade + 1;
    try {
      const no = await this.ilet(g);
      await this.kayitGuncelle(kayitId, { durum: "gonderildi", deneme, saglayiciNo: no, gonderildiAt: new Date(), hata: null });
    } catch (hata) {
      const sinif = smtpHataSinifi(hata), metin = hataMetni(hata);
      if (sinif !== "gecici") {
        await this.kayitGuncelle(kayitId, { durum: sinif === "belirsiz" ? "belirsiz" : "basarisiz", deneme, hata: metin });
        throw new UnrecoverableError(metin);
      }
      await this.kayitGuncelle(kayitId, { durum: deneme >= DENEME_SAYISI ? "basarisiz" : "kuyrukta", deneme, hata: metin });
      throw hata;
    }
  }

  async smsHazir(): Promise<boolean> {
    if (!this.kayitEtkin) return false;
    return (await this.platform.db.platformSmsAyari.count({ where: { id: 1 } })) > 0;
  }

  /** ILT-12: sistem SMS'i; platform hesabından tek deneme, metin kayda yazılmaz, numara maskelenir. */
  async smsGonder(g: { tur: string; telefon: string; mesaj: string; tenantId?: string | null }): Promise<void> {
    const telefon = telefonE164(g.telefon);
    if (!telefon) throw new IletiGonderilemedi("Geçersiz telefon numarası");
    const ayar = this.kayitEtkin ? await this.platform.db.platformSmsAyari.findUnique({ where: { id: 1 } }) : null;
    if (!ayar) throw new IletiGonderilemedi("Sistem SMS hesabı tanımlı değil");
    const id = await this.kayitAc({ tur: g.tur, tenantId: g.tenantId, alicilar: [`${telefon.slice(0, 6)}*****${telefon.slice(-2)}`], konu: "SMS" }, "sms");
    if (id === null) return;
    try {
      const { gorevId } = await smsSaglayiciAl("netgsm")!.smsGonder({ kullaniciAdi: ayar.kullaniciAdi, parola: coz(ayar.sifreliParola), gondericiAdi: ayar.gondericiAdi }, telefon, g.mesaj);
      await this.kayitGuncelle(id, { durum: "gonderildi", deneme: 1, saglayiciNo: gorevId, gonderildiAt: new Date(), hata: null });
    } catch (hata) {
      await this.kayitGuncelle(id, { durum: hata instanceof SmsReddedildi ? "basarisiz" : "belirsiz", deneme: 1, hata: hataMetni(hata) });
      throw new IletiGonderilemedi(hataMetni(hata));
    }
  }

  async smsAyarGetir() {
    const a = await this.platform.db.platformSmsAyari.findUnique({ where: { id: 1 } });
    return a ? { yapilandirildi: true, kullaniciAdi: a.kullaniciAdi, gondericiAdi: a.gondericiAdi } : { yapilandirildi: false, kullaniciAdi: "", gondericiAdi: "" };
  }

  async smsAyarKaydet(g: z.infer<typeof platformSmsAyariSemasi>) {
    const { kullaniciId } = aktifPlatformBaglam();
    await this.platform.db.$transaction(async (tx) => {
      const eski = await tx.platformSmsAyari.findUnique({ where: { id: 1 } });
      if (!g.parola && !eski) throw new ConflictException("Parola zorunludur");
      const veri = { kullaniciAdi: g.kullaniciAdi, gondericiAdi: g.gondericiAdi, sifreliParola: g.parola ? sifrele(g.parola) : eski!.sifreliParola, guncelleyenId: kullaniciId };
      await tx.platformSmsAyari.upsert({ where: { id: 1 }, create: { id: 1, ...veri }, update: veri });
      await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "sms_ayari_degisti", detay: { parolaDegisti: Boolean(g.parola) } } });
    });
    return this.smsAyarGetir();
  }

  async smsTest(telefon: string) {
    try { await this.smsGonder({ tur: "test", telefon, mesaj: "TekirExtra sistem SMS testi." }); return { basarili: true, mesaj: "Test SMS'i gönderildi." }; }
    catch (h) { return { basarili: false, mesaj: h instanceof Error ? h.message : "Gönderilemedi" }; }
  }

  // ─── panel ────────────────────────────────────────────────────────────────

  async ayarGetir() {
    const a = await this.platform.db.platformIletiAyari.findUnique({ where: { id: 1 } });
    if (!a) return { yapilandirildi: false, parolaKayitli: false, host: "", port: 587, guvenlik: "starttls" as const, kullaniciAdi: "", gondericiAdi: "TekirExtra", gondericiEposta: "", yanitAdresi: "" };
    const { sifreliParola, id: _id, guncelleyenId: _g, ...acik } = a;
    return { ...acik, kullaniciAdi: a.kullaniciAdi ?? "", yanitAdresi: a.yanitAdresi ?? "", yapilandirildi: true, parolaKayitli: Boolean(sifreliParola) };
  }

  async ayarKaydet(g: z.infer<typeof platformIletiAyariSemasi>) {
    const { kullaniciId } = aktifPlatformBaglam();
    const db = this.platform.db;
    await db.$transaction(async (tx) => {
      const eski = await tx.platformIletiAyari.findUnique({ where: { id: 1 } });
      if (g.kullaniciAdi && !g.parola && !eski?.sifreliParola) throw new ConflictException("Kullanıcı adı girildiyse parola zorunludur");
      const veri = { host: g.host, port: g.port, guvenlik: g.guvenlik, kullaniciAdi: g.kullaniciAdi || null, sifreliParola: !g.kullaniciAdi ? null : g.parola ? sifrele(g.parola) : eski?.sifreliParola ?? null, gondericiAdi: g.gondericiAdi, gondericiEposta: g.gondericiEposta, yanitAdresi: g.yanitAdresi || null, guncelleyenId: kullaniciId };
      await tx.platformIletiAyari.upsert({ where: { id: 1 }, create: { id: 1, ...veri }, update: veri });
      const degisen = (Object.keys(veri) as (keyof typeof veri)[]).filter((k) => k !== "guncelleyenId" && (k === "sifreliParola" ? Boolean(g.parola) : eski?.[k] !== veri[k]));
      await tx.mevzuatOlay.create({ data: { kullaniciId, olay: "ileti_ayari_degisti", detay: { degisen } } });
    });
    return this.ayarGetir();
  }

  async testGonder(alici: string) {
    try { await this.gonder({ tur: "test", alicilar: [alici], konu: "TekirExtra e-posta bağlantı testi", metin: "Platform e-posta ayarlarınız çalışıyor. Bu ileti platform panelinden test için gönderildi." }); return { basarili: true, mesaj: `${alici} adresine gönderildi.` }; }
    catch (h) { return { basarili: false, mesaj: h instanceof Error ? h.message : "Gönderilemedi" }; }
  }

  async kayitlar(durum?: string, sayfa = 1) {
    const take = 50;
    const where = durum ? { durum } : {};
    const [satirlar, toplam] = await Promise.all([
      this.platform.db.platformIletiKaydi.findMany({ where, orderBy: { createdAt: "desc" }, skip: (Math.max(1, sayfa) - 1) * take, take }),
      this.platform.db.platformIletiKaydi.count({ where }),
    ]);
    return { satirlar: satirlar.map(({ anahtar: _a, ...s }) => s), toplam, sayfa, sayfaBoyutu: take };
  }

  /** ILT-08: firma başına sayılar; firmanın cari iletilerinin alıcısı ve konusu bu yoldan okunamaz. */
  firmaSayilari(gun = 30) {
    return this.platform.db.$queryRaw<FirmaIletiSayisi[]>`SELECT tenant_id AS "tenantId", firma, sistem_toplam AS "sistemToplam", sistem_hata AS "sistemHata", eposta_toplam AS "epostaToplam", eposta_hata AS "epostaHata", sms_toplam AS "smsToplam", sms_hata AS "smsHata" FROM platform_ileti_firma_sayilari(${gun}::integer)`;
  }

  /** Yalnız kuyruktan geçip başarısız kalan ve hâlâ saklı olan iş yeniden gönderilebilir. */
  async yenidenGonder(id: string) {
    const k = await this.platform.db.platformIletiKaydi.findUnique({ where: { id } });
    if (!k) throw new NotFoundException("Kayıt bulunamadı");
    if (k.durum !== "basarisiz") throw new ConflictException("Yalnız başarısız ileti yeniden gönderilir");
    const is = this.kuyrukEtkin ? await Job.fromId<IsVerisi>(this.kuyruk, id) : null;
    if (!is) throw new ConflictException("İletinin içeriği saklanmıyor; asıl işlemi yeniden başlatın");
    await is.retry("failed");
    await this.kayitGuncelle(id, { durum: "kuyrukta", hata: null });
    return { kuyruga: true };
  }

  /** ILT-15: Sistem Sağlığı için son bir saat ve sunucu erişimi. */
  async ozet(simdi = new Date()): Promise<IletiOzeti> {
    if (!this.kayitEtkin) return { toplam: 0, basarisiz: 0, bekleyenEnEskiDk: null, smtpHatasi: null };
    const db = this.platform.db, bas = new Date(simdi.getTime() - 3_600_000);
    const [toplam, basarisiz, enEski] = await Promise.all([
      db.platformIletiKaydi.count({ where: { createdAt: { gte: bas } } }),
      db.platformIletiKaydi.count({ where: { createdAt: { gte: bas }, durum: { in: ["basarisiz", "belirsiz"] } } }),
      db.platformIletiKaydi.findFirst({ where: { durum: "kuyrukta" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    ]);
    let smtpHatasi: string | null = null;
    try { const { transport } = await this.tasiyici(); await transport.verify(); transport.close(); } catch (h) { smtpHatasi = hataMetni(h); }
    return { toplam, basarisiz, bekleyenEnEskiDk: enEski ? Math.floor((simdi.getTime() - enEski.createdAt.getTime()) / 60_000) : null, smtpHatasi };
  }
}
