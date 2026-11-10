import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnrecoverableError } from "bullmq";
import { hataMetni, iletiSorunlari, IletiSiniriAsildi, istanbulAyBasi, smtpHataSinifi, tavanIhlali, VARSAYILAN_TAVANLAR } from "./ileti-kurallari";
import { odemeBaglantisiSmsSablonu, smsParcaSayisi, sozSmsSablonu, telefonE164, vadeSmsSablonu } from "./sms-kurallari";
import { sablonDogrula, sablonDoldur, sablonTanimi, SABLONLAR, varsayilanSablon } from "./ileti-sablonlari";
import { SmsService } from "./sms.service";
import { BildirimEpostaService } from "../bildirimler/bildirim-eposta.service";
import { SmsKodService, telefonMaskele } from "./sms-kod.service";
import { NetgsmAdapter, SmsReddedildi } from "../pos/netgsm.adapter";
import { sifrele } from "../core/kripto";
import { IletiGonderilemedi, PlatformIletiService } from "./platform-ileti.service";
import { EpostaService } from "../tenant/eposta.service";
import { baglamlaCalistir } from "../core/istek-baglami";

const baglamla = <T>(f: () => Promise<T>) => baglamlaCalistir({ tenantId: "t1", userId: "u1", rol: "muhasebe" } as never, f);

const giden: { to: string; subject: string }[] = [];
let hata: unknown = null;
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail: async (m: { to: string; subject: string }) => { if (hata) throw hata; giden.push(m); return { messageId: "m1" }; } }) }));

function kur() {
  const kayitlar: Record<string, unknown>[] = [], anahtarlar = new Set<string>();
  const db = {
    platformIletiAyari: { findUnique: async () => null },
    platformIletiKaydi: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (data.anahtar && anahtarlar.has(String(data.anahtar))) { const { Prisma } = await import("@prisma/client"); throw new Prisma.PrismaClientKnownRequestError("yinelenen", { code: "P2002", clientVersion: "x" }); }
        if (data.anahtar) anahtarlar.add(String(data.anahtar));
        const k = { id: `k${kayitlar.length + 1}`, ...data }; kayitlar.push(k); return k;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(kayitlar.find((k) => k.id === where.id)!, data),
    },
  };
  process.env.DATABASE_URL_PLATFORM = "x";
  giden.length = 0; hata = null;
  return { servis: new PlatformIletiService({ db } as never), kayitlar };
}
const ileti = { tur: "test", alicilar: ["a@b.co"], konu: "K", metin: "M" };

describe("hata sınıfı", () => {
  it("kimlik ve alıcı reddi kalıcı, 4xx ve ağ hatası geçici", () => {
    expect(smtpHataSinifi({ code: "EAUTH" })).toBe("kalici");
    expect(smtpHataSinifi({ code: "EENVELOPE" })).toBe("kalici");
    expect(smtpHataSinifi({ responseCode: 550 })).toBe("kalici");
    expect(smtpHataSinifi({ responseCode: 451 })).toBe("gecici");
    expect(smtpHataSinifi({ code: "ECONNREFUSED" })).toBe("gecici");
  });
  it("içerik verilirken kopan bağlantı belirsizdir", () => {
    expect(smtpHataSinifi({ code: "ESOCKET", command: "DATA" })).toBe("belirsiz");
    expect(smtpHataSinifi({ responseCode: 451, command: "DATA" })).toBe("gecici");
  });
  it("mesajı boş hatada kodu yazar", () => {
    expect(hataMetni(Object.assign(new Error(""), { code: "ECONNREFUSED" }))).toBe("ECONNREFUSED");
  });
});

describe("alarm", () => {
  const taban = { toplam: 0, basarisiz: 0, bekleyenEnEskiDk: null, smtpHatasi: null };
  it("eşik altında sessiz", () => {
    expect(iletiSorunlari({ ...taban, toplam: 2, basarisiz: 2 })).toEqual([]);
    expect(iletiSorunlari({ ...taban, toplam: 10, basarisiz: 1, bekleyenEnEskiDk: 14 })).toEqual([]);
  });
  it("oran, kuyruk ve sunucu ayrı alarmdır", () => {
    expect(iletiSorunlari({ toplam: 5, basarisiz: 1, bekleyenEnEskiDk: 15, smtpHatasi: "ECONNREFUSED" }).map((s) => s.anahtar)).toEqual(["ileti:smtp", "ileti:hata-orani", "ileti:kuyruk"]);
  });
});

describe("gönderim", () => {
  it("başarılı gönderim kayda geçer, gövde kayda yazılmaz", async () => {
    const { servis, kayitlar } = kur();
    expect(await servis.gonder(ileti)).toEqual({ gonderildi: true });
    expect(giden).toHaveLength(1);
    expect(kayitlar[0]).toMatchObject({ durum: "gonderildi", deneme: 1, saglayiciNo: "m1" });
    expect(JSON.stringify(kayitlar[0])).not.toContain('"M"');
  });
  it("hata kayda geçer ve çağırana bildirilir", async () => {
    const { servis, kayitlar } = kur(); hata = Object.assign(new Error("reddedildi"), { code: "EAUTH" });
    await expect(servis.gonder(ileti)).rejects.toBeInstanceOf(IletiGonderilemedi);
    expect(kayitlar[0]).toMatchObject({ durum: "basarisiz", hata: "reddedildi" });
  });
  it("aynı anahtarla ikinci ileti çıkmaz", async () => {
    const { servis } = kur();
    await servis.gonder({ ...ileti, anahtar: "x" });
    expect(await servis.gonder({ ...ileti, anahtar: "x" })).toEqual({ gonderildi: false });
    expect(giden).toHaveLength(1);
  });
  it("alıcısız ileti kayıt açmaz", async () => {
    const { servis, kayitlar } = kur();
    await servis.gonder({ ...ileti, alicilar: [] });
    expect(kayitlar).toHaveLength(0);
  });
  it("kuyruk yoksa kuyruga tek deneme yapar", async () => {
    const { servis } = kur();
    await servis.kuyruga(ileti);
    expect(giden).toHaveLength(1);
  });
  it("ömrü dolan anlık ileti gönderilmez (ILT-04)", async () => {
    const { servis, kayitlar } = kur();
    await servis.gonder(ileti);
    const adet = giden.length;
    await expect((servis as unknown as { isle(j: unknown): Promise<void> }).isle({ attemptsMade: 2, data: { kayitId: kayitlar[0].id, tur: "parola_sifirlama", alicilar: ["a@b.co"], konu: "K", metin: "M", sonGecerlilik: Date.now() - 1 } })).rejects.toBeInstanceOf(UnrecoverableError);
    expect(giden).toHaveLength(adet);
    expect(kayitlar[0].durum).toBe("suresi_doldu");
  });
});

describe("ileti şablonları (ILT-09)", () => {
  const fatura = sablonTanimi("fatura_eposta"), sms = sablonTanimi("odeme_baglantisi_sms");
  const degerler = { cari: "ACME", belge_no: "F1", belge_adi: "faturanız" };
  it("varsayılan metin değişmeden üretilir", () => {
    expect(sablonDoldur(fatura, null, degerler)).toEqual({ konu: "Fatura F1", metin: "Sayın ACME,\n\nF1 numaralı faturanız ekte yer almaktadır.\n\nİyi çalışmalar dileriz.", ozel: false });
  });
  it("her varsayılan şablon kendi değişkenleriyle geçerlidir", () => {
    for (const t of SABLONLAR) expect(() => sablonDogrula(t, { konu: t.konu, metin: t.metin }), t.tur).not.toThrow();
  });
  it("eksik değişken gönderimi durdurur, boş metin geçerlidir", () => {
    expect(() => sablonDoldur(fatura, null, { cari: "A", belge_adi: "x" })).toThrow("belge_no");
    expect(sablonDoldur(sablonTanimi("belge_eposta"), null, { cari: "A", belge_no: "1", belge_turu: "T", belge_turu_kucuk: "t", gecerlilik_cumlesi: "" }).metin).toContain("ekte yer almaktadır.\n");
  });
  it("değerin içindeki yer tutucu yeniden işlenmez", () => {
    expect(sablonDoldur(fatura, null, { ...degerler, cari: "{{belge_no}}" }).metin).toContain("Sayın {{belge_no}},");
  });
  it("bilinmeyen, bozuk ve zorunlu eksik şablon kaydedilemez", () => {
    expect(() => sablonDogrula(fatura, { konu: "K", metin: "{{tutar}}" })).toThrow("Bilinmeyen");
    expect(() => sablonDogrula(fatura, { konu: "K", metin: "{{cari" })).toThrow("biçiminde");
    expect(() => sablonDogrula(sms, { metin: "Bağlantısız metin" })).toThrow("baglanti");
    expect(() => sablonDogrula(fatura, { konu: "", metin: "M" })).toThrow("Konu");
    expect(sablonDogrula(sms, { konu: "yok sayılır", metin: "{{baglanti}}" }).konu).toBeNull();
  });
  it("düzenlenmiş sistem şablonu gömülü HTML'i taşımaz", async () => {
    const ileti = { kuyruga: vi.fn(async () => undefined), gonder: vi.fn() };
    const uret = vi.fn(async () => ({ konu: "Ozel", metin: "Ozel metin", ozel: true }));
    const s = new EpostaService({} as never, ileti as never, { uret } as never);
    await baglamla(() => s.parolaSifirlamaGonder("u@x.co", "Ali", "http://l", 30));
    expect(ileti.kuyruga).toHaveBeenCalledWith(expect.objectContaining({ konu: "Ozel", metin: "Ozel metin", html: undefined, tur: "parola_sifirlama" }));
  });
  it("varsayılan sistem şablonu HTML'i korur", async () => {
    const ileti = { kuyruga: vi.fn(async () => undefined), gonder: vi.fn() };
    await baglamla(() => new EpostaService({} as never, ileti as never).parolaSifirlamaGonder("u@x.co", "Ali", "http://l", 30));
    expect(ileti.kuyruga).toHaveBeenCalledWith(expect.objectContaining({ konu: "TekirExtra — parola sıfırlama", html: expect.stringContaining("http://l") }));
  });
});

describe("gönderim tavanları (ILT-14)", () => {
  it("günlük önce, sonra aylık sınır denetlenir", () => {
    expect(tavanIhlali("eposta", { gunluk: 9, aylik: 99 }, { gunluk: 10, aylik: 100 })).toBeNull();
    expect(tavanIhlali("eposta", { gunluk: 10, aylik: 100 }, { gunluk: 10, aylik: 100 })?.neden).toBe("gunluk");
    expect(tavanIhlali("sms", { gunluk: 1, aylik: 100 }, { gunluk: 10, aylik: 100 })?.kayit).toBe("Aylık SMS tavanı doldu");
  });
  it("ay başı İstanbul saatine göre hesaplanır", () => {
    expect(istanbulAyBasi(new Date("2026-11-30T21:30:00Z")).toISOString()).toBe("2026-11-30T21:00:00.000Z");
    expect(istanbulAyBasi(new Date("2026-11-30T20:30:00Z")).toISOString()).toBe("2026-10-31T21:00:00.000Z");
  });
  it("firma istisnası yalnız dolu alanları değiştirir", async () => {
    vi.stubEnv("DATABASE_URL_PLATFORM", "postgres://x"); vi.stubEnv("SMS_GUNLUK_TAVAN", "");
    const db = { platformIletiLimit: { findUnique: async () => ({ id: 1, epostaGunluk: 50, epostaAylik: 500, smsGunluk: 5, smsAylik: 60 }) }, platformIletiFirmaLimit: { findMany: async () => [{ tenantId: "t9", epostaGunluk: 70, epostaAylik: null, smsGunluk: null, smsAylik: null }] } };
    const s = new PlatformIletiService({ db } as never);
    expect(await s.tavan("t9", "eposta")).toEqual({ gunluk: 70, aylik: 500 });
    expect(await s.tavan("t1", "sms")).toEqual({ gunluk: 5, aylik: 60 });
    vi.unstubAllEnvs();
  });
  it("ayar yoksa onaylı varsayılanlar geçerlidir", async () => {
    vi.stubEnv("DATABASE_URL_PLATFORM", ""); vi.stubEnv("SMS_GUNLUK_TAVAN", "");
    expect(await new PlatformIletiService({} as never).tavan("t1", "eposta")).toEqual({ gunluk: VARSAYILAN_TAVANLAR.epostaGunluk, aylik: VARSAYILAN_TAVANLAR.epostaAylik });
    vi.unstubAllEnvs();
  });
});

describe("firma başına sayılar (ILT-08)", () => {
  it("yalnız sayı alanlarını döner, kapalı işlevden okur", async () => {
    const satir = { tenantId: "t1", firma: "A", sistemToplam: 2, sistemHata: 1, epostaToplam: 5, epostaHata: 0, smsToplam: 1, smsHata: 0 };
    const queryRaw = vi.fn(async () => [satir]);
    const servis = new PlatformIletiService({ db: { $queryRaw: queryRaw } } as never);
    await expect(servis.firmaSayilari(7)).resolves.toEqual([satir]);
    const [parcalar, gun] = queryRaw.mock.calls[0] as unknown as [string[], number];
    expect(parcalar.join("")).toContain("platform_ileti_firma_sayilari");
    expect(parcalar.join("")).not.toMatch(/alici|konu/);
    expect(gun).toBe(7);
  });
});

describe("firma e-posta servisi (ILT-02)", () => {
  const gidenFirma: Record<string, unknown>[] = [], kayitlar: Record<string, unknown>[] = [];
  let sira: unknown[] = [];
  const sayim = { tavan: 0, tekrar: 0 };
  const kur2 = (firmaAyari: unknown) => {
    gidenFirma.length = 0; kayitlar.length = 0;
    const transport = { sendMail: async (m: Record<string, unknown>) => { const h = sira.shift(); if (h) throw h; gidenFirma.push(m); return { messageId: "mid" }; } };
    const tx = { $queryRaw: async () => [], modulAyar: { findUnique: async () => (firmaAyari ? { ayarlar: firmaAyari } : null) }, tenant: { findUnique: async () => ({ eposta: "firma@ornek.co" }) }, epostaGonderim: { findUnique: async ({ where }: { where: { tenantId_anahtar: { anahtar: string } } }) => kayitlar.find((k) => k.anahtar === where.tenantId_anahtar.anahtar) ?? null, count: async ({ where }: { where: { alici?: string } }) => (where.alici ? sayim.tekrar : sayim.tavan), create: async ({ data }: { data: Record<string, unknown> }) => { if (data.anahtar && kayitlar.some((k) => k.anahtar === data.anahtar)) { const { Prisma } = await import("@prisma/client"); throw new Prisma.PrismaClientKnownRequestError("yinelenen", { code: "P2002", clientVersion: "x" }); } const k = { id: `e${kayitlar.length + 1}`, ...data }; kayitlar.push(k); return k; }, update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(kayitlar.find((k) => k.id === where.id)!, data) } };
    const prisma = { tenantIslem: async (_t: string, f: (t: typeof tx) => unknown) => f(tx) };
    const ileti = { tavan: vi.fn(async () => ({ gunluk: 10, aylik: 100 })), kuyruga: vi.fn(async () => undefined), tasiyici: vi.fn(async () => ({ transport, from: "TekirExtra <p@t.co>", replyTo: undefined })), gonder: vi.fn(async () => ({ gonderildi: true })) };
    return { servis: new EpostaService(prisma as never, ileti as never), ileti };
  };
  beforeEach(() => { sira = []; sayim.tavan = 0; sayim.tekrar = 0; });
  afterEach(() => { vi.useRealTimers(); });
  const tasiyiciBagla = (servis: EpostaService) => vi.spyOn(servis as never, "transporter" as never).mockResolvedValue({ transport: { sendMail: async (m: Record<string, unknown>) => { gidenFirma.push(m); return { messageId: "mid" }; } }, from: "f@o.co", gonderen: "firma" } as never);
  it("tavan doluysa ileti çıkmaz, anahtar bırakılır, firma kaydında görünür (ILT-14)", async () => {
    const { servis } = kur2({ host: "smtp.ornek.co" }); tasiyiciBagla(servis);
    sayim.tavan = 10;
    await expect(baglamla(() => servis.iletiGonder({ alici: "a@b.co", konu: "K", metin: "M", anahtar: "bildirim:9" }))).rejects.toBeInstanceOf(IletiSiniriAsildi);
    expect(gidenFirma).toHaveLength(0);
    expect(kayitlar[0]).toMatchObject({ durum: "basarisiz", hataMesaji: "Günlük e-posta tavanı doldu" });
    expect(kayitlar[0].anahtar).toBeUndefined();
  });
  it("tekrar sınırı yalnız otomatik iletiye uygulanır ve kayıt açmaz (ILT-14)", async () => {
    const { servis } = kur2({ host: "smtp.ornek.co" }); tasiyiciBagla(servis);
    sayim.tekrar = 5;
    await expect(baglamla(() => servis.iletiGonder({ alici: "a@b.co", konu: "K", metin: "M", tur: "bildirim", otomatik: true }))).rejects.toMatchObject({ neden: "tekrar" });
    expect(kayitlar).toHaveLength(0);
    await baglamla(() => servis.iletiGonder({ alici: "a@b.co", konu: "K", metin: "M" }));
    expect(gidenFirma).toHaveLength(1);
  });
  it("anlık sistem iletisi tavana sayılmaz, davet tek deneme kalır (ILT-04/14)", async () => {
    const { servis, ileti } = kur2({ host: "smtp.firma.co" });
    sayim.tavan = 999;
    await baglamla(() => servis.dogrulamaGonder("u@x.co", "Ali", "http://l"));
    expect(ileti.kuyruga).toHaveBeenCalledWith(expect.objectContaining({ tur: "dogrulama", anlik: true }));
    await baglamla(() => servis.kullaniciDavetGonder("u@x.co", "Ali", "F", "http://l", 3));
    expect(ileti.gonder).toHaveBeenCalledWith(expect.objectContaining({ tur: "kullanici_davet" }));
    expect(ileti.tavan).not.toHaveBeenCalled();
  });
  it("aynı anahtarla ikinci ileti çıkmaz (ILT-05)", async () => {
    const { servis } = kur2({ host: "smtp.ornek.co", port: 587, guvenlik: "starttls", gondericiAdi: "F", gondericiEposta: "f@o.co" });
    vi.spyOn(servis as never, "transporter" as never).mockResolvedValue({ transport: { sendMail: async (m: Record<string, unknown>) => { const h = sira.shift(); if (h) throw h; gidenFirma.push(m); return { messageId: "mid" }; } }, from: "f@o.co", gonderen: "firma" } as never);
    const g = { alici: "a@b.co", konu: "K", metin: "M", anahtar: "bildirim:1" };
    await baglamla(() => servis.iletiGonder(g));
    await baglamla(() => servis.iletiGonder(g));
    expect(gidenFirma).toHaveLength(1);
    expect(kayitlar).toHaveLength(1);
    expect(kayitlar[0]).toMatchObject({ durum: "gonderildi", deneme: 1 });
    expect(String(kayitlar[0].anahtar)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("kesin başarısızlık anahtarı bırakır, sonraki tur yeniden dener", async () => {
    const { servis } = kur2({ host: "smtp.ornek.co", port: 587, guvenlik: "starttls", gondericiAdi: "F", gondericiEposta: "f@o.co" });
    vi.spyOn(servis as never, "transporter" as never).mockResolvedValue({ transport: { sendMail: async (m: Record<string, unknown>) => { const h = sira.shift(); if (h) throw h; gidenFirma.push(m); return { messageId: "mid" }; } }, from: "f@o.co", gonderen: "firma" } as never);
    const g = { alici: "a@b.co", konu: "K", metin: "M", anahtar: "bildirim:2" };
    sira = [Object.assign(new Error("reddedildi"), { responseCode: 550 })];
    await expect(baglamla(() => servis.iletiGonder(g))).rejects.toThrow();
    expect(kayitlar[0]).toMatchObject({ durum: "basarisiz", anahtar: null });
    await baglamla(() => servis.iletiGonder(g));
    expect(gidenFirma).toHaveLength(1);
  });
  it("belirsiz sonuçta anahtar kalır, tekrar gönderilmez", async () => {
    const { servis } = kur2({ host: "smtp.ornek.co", port: 587, guvenlik: "starttls", gondericiAdi: "F", gondericiEposta: "f@o.co" });
    vi.spyOn(servis as never, "transporter" as never).mockResolvedValue({ transport: { sendMail: async (m: Record<string, unknown>) => { const h = sira.shift(); if (h) throw h; gidenFirma.push(m); return { messageId: "mid" }; } }, from: "f@o.co", gonderen: "firma" } as never);
    const g = { alici: "a@b.co", konu: "K", metin: "M", anahtar: "bildirim:3" };
    sira = [Object.assign(new Error("kesildi"), { code: "ECONNRESET", command: "DATA" })];
    await expect(baglamla(() => servis.iletiGonder(g))).rejects.toThrow();
    expect(kayitlar[0].durum).toBe("belirsiz");
    expect(kayitlar[0].anahtar).toBeTruthy();
    await baglamla(() => servis.iletiGonder(g));
    expect(gidenFirma).toHaveLength(0);
  });
  it("sistem iletisi firma bağlamı olsa da platformdan çıkar", async () => {
    const { servis, ileti } = kur2({ host: "smtp.firma.co" });
    await baglamla(() => servis.parolaSifirlamaGonder("u@x.co", "Ali", "http://l", 30));
    expect(ileti.kuyruga).toHaveBeenCalledWith(expect.objectContaining({ tur: "parola_sifirlama", alicilar: ["u@x.co"], tenantId: "t1", anlik: true }));
    expect(kayitlar).toHaveLength(0);
  });
  it("SMTP'si olmayan firma platformdan, yanıt adresi kendi e-postası olarak gönderir", async () => {
    const { servis, ileti } = kur2(null);
    await baglamla(() => servis.iletiGonder({ alici: "c@x.co", konu: "K", metin: "M" }));
    expect(ileti.tasiyici).toHaveBeenCalled();
    expect(gidenFirma[0]).toMatchObject({ from: "TekirExtra <p@t.co>", replyTo: "firma@ornek.co" });
    expect(kayitlar[0]).toMatchObject({ gonderen: "platform", durum: "gonderildi", saglayiciNo: "mid" });
    expect(ileti.gonder).not.toHaveBeenCalled();
  });
  it("geçici hata aynı istekte yeniden denenir", async () => {
    vi.useFakeTimers();
    const { servis } = kur2(null); sira = [{ code: "ECONNREFUSED" }];
    const s = baglamla(() => servis.iletiGonder({ alici: "c@x.co", konu: "K", metin: "M" }));
    await vi.advanceTimersByTimeAsync(1_100);
    await s;
    expect(kayitlar[0]).toMatchObject({ durum: "gonderildi", deneme: 2 });
  });
  it("kalıcı hata yeniden denenmez ve çağırana bildirilir", async () => {
    const { servis } = kur2(null); sira = [Object.assign(new Error("reddedildi"), { code: "EAUTH" })];
    await expect(baglamla(() => servis.iletiGonder({ alici: "c@x.co", konu: "K", metin: "M" }))).rejects.toThrow("reddedildi");
    expect(kayitlar[0]).toMatchObject({ durum: "basarisiz", deneme: 1, gonderen: "platform" });
  });
  it("içerik sırasında kopan bağlantı belirsizdir, tekrar edilmez", async () => {
    const { servis } = kur2(null); sira = [{ code: "ESOCKET", command: "DATA", message: "koptu" }];
    await expect(baglamla(() => servis.iletiGonder({ alici: "c@x.co", konu: "K", metin: "M" }))).rejects.toBeTruthy();
    expect(kayitlar[0]).toMatchObject({ durum: "belirsiz", deneme: 1 });
  });
  it("ödeme sözü iletisi geçici hatada da tek denemedir", async () => {
    const { servis } = kur2(null); sira = [{ code: "ECONNREFUSED" }];
    await expect(baglamla(() => servis.odemeSozuHatirlat({ alici: "c@x.co", konu: "K", metin: "M", messageId: "<a@b>" }))).rejects.toBeTruthy();
    expect(kayitlar[0]).toMatchObject({ durum: "basarisiz", deneme: 1 });
  });
});

describe("SMS kuralları", () => {
  it("numara E.164'e çevrilir, geçersiz reddedilir", () => {
    expect(telefonE164("0532 111 22 33")).toBe("+905321112233");
    expect(telefonE164("+90 532 111 2233")).toBe("+905321112233");
    expect(telefonE164("5321112233")).toBe("+905321112233");
    expect(telefonE164("0212 111 22 33")).toBeNull();
    expect(telefonE164("123")).toBeNull();
  });
  it("Türkçe karakter parça sınırını düşürür", () => {
    expect(smsParcaSayisi("a".repeat(160))).toBe(1);
    expect(smsParcaSayisi("a".repeat(161))).toBe(2);
    expect(smsParcaSayisi("ş" + "a".repeat(154))).toBe(1);
    expect(smsParcaSayisi("ş" + "a".repeat(155))).toBe(2);
  });
  it("metinler firma adını taşır, uzun ad kırpılır", () => {
    const m = varsayilanSablon(vadeSmsSablonu({ firma: "ACME", unvan: "B".repeat(80), toplam: "1.000,00 TL", ihtar: false })).metin;
    expect(m).toContain("ACME"); expect(m).toContain("1.000,00 TL"); expect(m.length).toBeLessThan(200);
    expect(varsayilanSablon(vadeSmsSablonu({ firma: "A", unvan: "B", toplam: "1 TL", ihtar: true })).metin).toContain("ihtar");
    expect(varsayilanSablon(sozSmsSablonu({ firma: "ACME", unvan: "B", tutar: "5 TRY" })).metin).toContain("ACME");
    expect(varsayilanSablon(odemeBaglantisiSmsSablonu({ unvan: "B", link: "https://l", faturaIcin: true })).metin).toContain("https://l");
  });
});

describe("SMS gönderimi (ILT-10)", () => {
  process.env.BAGLANTI_SIFRELEME_ANAHTARI ??= "0".repeat(64);
  afterEach(() => { vi.restoreAllMocks(); delete process.env.SMS_GUNLUK_TAVAN; });
  const kur3 = (b: { baglanti?: boolean; bugun?: number; anahtarVar?: boolean; aylikTavan?: number; tekrar?: number } = {}) => {
    const satirlar: Record<string, unknown>[] = [];
    const tx = {
      $queryRaw: async () => [],
      smsGonderim: {
        findUnique: async () => (b.anahtarVar ? { id: "e" } : null),
        count: async ({ where }: { where: { telefon?: string } }) => (where.telefon ? b.tekrar ?? 0 : b.bugun ?? 0),
        create: async ({ data }: { data: Record<string, unknown> }) => { const k = { id: `s${satirlar.length + 1}`, ...data }; satirlar.push(k); return k; },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(satirlar.find((s) => s.id === where.id)!, data),
      },
      baglanti: { findFirst: async () => (b.baglanti === false ? null : { saglayici: "netgsm", sifreliConfig: sifrele(JSON.stringify({ kullaniciAdi: "u", parola: "p", gondericiAdi: "ACME" })) }) },
    };
    return { servis: new SmsService({ tenantIslem: async (_t: string, f: (t: typeof tx) => unknown) => f(tx) } as never, { tavan: async () => ({ gunluk: 3, aylik: b.aylikTavan ?? 100 }) } as never), satirlar };
  };
  const sms = { tur: "vade_hatirlatma", telefon: "05321112233", mesaj: "GIZLI-METIN" };
  it("gönderir, kaydeder, metni yazmaz", async () => {
    const yolla = vi.spyOn(NetgsmAdapter.prototype, "smsGonder").mockResolvedValue({ gorevId: "j1" });
    const { servis, satirlar } = kur3();
    expect(await baglamla(() => servis.gonder(sms))).toEqual({ gorevId: "j1", yinelenen: false });
    expect(yolla.mock.calls[0]?.[1]).toBe("+905321112233");
    expect(satirlar[0]).toMatchObject({ durum: "gonderildi", gorevNo: "j1", telefon: "+905321112233" });
    expect(JSON.stringify(satirlar)).not.toContain("GIZLI");
  });
  it("hesap yoksa başarısız yazılır, gönderilmez", async () => {
    const yolla = vi.spyOn(NetgsmAdapter.prototype, "smsGonder");
    const { servis, satirlar } = kur3({ baglanti: false });
    await expect(baglamla(() => servis.gonder(sms))).rejects.toThrow("SMS hesabı bağlı değil");
    expect(satirlar[0]).toMatchObject({ durum: "basarisiz", hata: "SMS hesabı yok" });
    expect(yolla).not.toHaveBeenCalled();
  });
  it("aylık tavan ve otomatik tekrar sınırı SMS'i durdurur (ILT-14)", async () => {
    const yolla = vi.spyOn(NetgsmAdapter.prototype, "smsGonder").mockClear();
    const aylik = kur3({ bugun: 2, aylikTavan: 2 });
    await expect(baglamla(() => aylik.servis.gonder(sms))).rejects.toMatchObject({ neden: "aylik" });
    expect(aylik.satirlar[0]).toMatchObject({ durum: "basarisiz", hata: "Aylık SMS tavanı doldu" });
    await expect(baglamla(() => kur3({ tekrar: 5 }).servis.gonder({ ...sms, otomatik: true }))).rejects.toMatchObject({ neden: "tekrar" });
    expect(yolla).not.toHaveBeenCalled();
    yolla.mockResolvedValueOnce({ gorevId: "j2" });
    expect(await baglamla(() => kur3({ tekrar: 5 }).servis.gonder(sms))).toMatchObject({ gorevId: "j2" });
  });
  it("günlük tavan aşılmaz", async () => {
    const yolla = vi.spyOn(NetgsmAdapter.prototype, "smsGonder");
    const { servis } = kur3({ bugun: 3 });
    await expect(baglamla(() => servis.gonder(sms))).rejects.toThrow("tavan");
    expect(yolla).not.toHaveBeenCalled();
  });
  it("sağlayıcı reddi başarısız, ağ hatası belirsizdir; ikisi de tekrar edilmez", async () => {
    const yolla = vi.spyOn(NetgsmAdapter.prototype, "smsGonder").mockRejectedValueOnce(new SmsReddedildi("kredi yok"));
    let k = kur3();
    await expect(baglamla(() => k.servis.gonder(sms))).rejects.toThrow("kredi yok");
    expect(k.satirlar[0]).toMatchObject({ durum: "basarisiz" });
    yolla.mockRejectedValueOnce(new Error("socket hang up"));
    k = kur3();
    await expect(baglamla(() => k.servis.gonder(sms))).rejects.toThrow("socket");
    expect(k.satirlar[0]).toMatchObject({ durum: "belirsiz" });
    expect(yolla).toHaveBeenCalledTimes(2);
  });
  it("aynı anahtarla ikinci SMS çıkmaz", async () => {
    const yolla = vi.spyOn(NetgsmAdapter.prototype, "smsGonder");
    const { servis } = kur3({ anahtarVar: true });
    expect(await baglamla(() => servis.gonder({ ...sms, anahtar: "soz:1" }))).toEqual({ gorevId: null, yinelenen: true });
    expect(yolla).not.toHaveBeenCalled();
  });
  it("geçersiz numara kayıt açmadan reddedilir", async () => {
    const { servis, satirlar } = kur3();
    await expect(baglamla(() => servis.gonder({ ...sms, telefon: "123" }))).rejects.toThrow("cep telefonu");
    expect(satirlar).toHaveLength(0);
  });
});

describe("SMS kodu (ILT-12)", () => {
  process.env.JWT_SECRET ??= "test-sir";
  const kur4 = (hata?: Error) => {
    const satirlar: Record<string, unknown>[] = [];
    const eslesir = (s: Record<string, unknown>, w: Record<string, unknown>) => Object.entries(w).every(([k, v]) => (v && typeof v === "object" && !(v instanceof Date)) ? ("gt" in v ? (s[k] as Date) > (v as { gt: Date }).gt : (s[k] as number) < (v as { lt: number }).lt) : s[k] === v);
    const tablo = {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => [...satirlar].reverse().find((s) => eslesir(s, where)) ?? null,
      count: async ({ where }: { where: Record<string, unknown> }) => satirlar.filter((s) => eslesir(s, where)).length,
      create: async ({ data }: { data: Record<string, unknown> }) => { const k = { id: `k${satirlar.length + 1}`, deneme: 0, kullanildi: false, createdAt: new Date(), ...data }; satirlar.push(k); return k; },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(satirlar.find((s) => s.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => { const h = satirlar.filter((s) => eslesir(s, where)); for (const s of h) { for (const [k, v] of Object.entries(data)) s[k] = v && typeof v === "object" ? (s[k] as number) + 1 : v; } return { count: h.length }; },
    };
    const tx = { $queryRaw: async () => [], smsDogrulamaKodu: tablo };
    const prisma = { $transaction: async (f: (t: typeof tx) => unknown) => f(tx), smsDogrulamaKodu: tablo };
    const mesajlar: string[] = [];
    const ileti = { smsGonder: vi.fn(async (m: { mesaj: string }) => { if (hata) throw hata; mesajlar.push(m.mesaj); }) };
    return { servis: new SmsKodService(prisma as never, ileti as never), satirlar, mesajlar, ileti };
  };
  const g = { tenantId: "t", userId: "u", amac: "giris" as const, telefon: "05321112233" };
  const kodu = (m: string[]) => /(\d{6})/.exec(m.at(-1)!)![1]!;
  it("kod özetlenir, doğru kod bir kez kullanılır", async () => {
    const { servis, satirlar, mesajlar } = kur4();
    expect(await servis.gonder(g)).toBe(true);
    const kod = kodu(mesajlar);
    expect(JSON.stringify(satirlar)).not.toContain(kod);
    expect(await servis.dogrula({ userId: "u", amac: "giris", kod })).toEqual({ telefon: "+905321112233" });
    expect(await servis.dogrula({ userId: "u", amac: "giris", kod })).toBeNull();
  });
  it("beşinci hatalı denemede doğru kod da geçersiz olur", async () => {
    const { servis, mesajlar } = kur4();
    await servis.gonder(g);
    const kod = kodu(mesajlar), yanlis = kod === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i += 1) expect(await servis.dogrula({ userId: "u", amac: "giris", kod: yanlis })).toBeNull();
    expect(await servis.dogrula({ userId: "u", amac: "giris", kod })).toBeNull();
  });
  it("süresi dolan ve başka amaçlı kod geçmez", async () => {
    const { servis, satirlar, mesajlar } = kur4();
    await servis.gonder(g);
    const kod = kodu(mesajlar);
    expect(await servis.dogrula({ userId: "u", amac: "parola_sifirla", kod })).toBeNull();
    satirlar[0]!.sonGecerlilik = new Date(Date.now() - 1000);
    expect(await servis.dogrula({ userId: "u", amac: "giris", kod })).toBeNull();
  });
  it("bir dakikadan önce yeniden gönderilmez", async () => {
    const { servis, ileti } = kur4();
    expect(await servis.gonder(g)).toBe(true);
    expect(await servis.gonder(g)).toBe(false);
    expect(ileti.smsGonder).toHaveBeenCalledTimes(1);
  });
  it("saatlik sınır kullanıcı ve telefon başınadır", async () => {
    const { servis, satirlar } = kur4();
    for (let i = 0; i < 5; i += 1) satirlar.push({ id: `e${i}`, userId: "baska", amac: "giris", telefon: "+905321112233", createdAt: new Date(Date.now() - 600_000), kullanildi: true });
    expect(await servis.gonder(g)).toBe(false);
  });
  it("gönderilemeyen kod iptal edilir", async () => {
    const { servis, satirlar } = kur4(new Error("kredi yok"));
    await expect(servis.gonder(g)).rejects.toThrow("kredi yok");
    expect(satirlar[0]).toMatchObject({ kullanildi: true });
  });
  it("numara maskelenir", () => {
    expect(telefonMaskele("+905321112233")).toBe("+90532*****33");
    expect(telefonMaskele(null)).toBeNull();
  });
});

describe("kritik bildirim SMS'i (ILT-11)", () => {
  const kur5 = (ek: { tercih?: boolean; sessiz?: boolean; hata?: boolean } = {}) => {
    const sms = { gonder: vi.fn(async () => { if (ek.hata) throw new Error("kredi yok"); return { gorevId: "j", yinelenen: false }; }) };
    const adaylar = [{ id: "t1", userId: "u1", bildirim: { tur: "donem", baslik: "KDV gecikti" }, kullanici: { telefon: "+905321112233", bildirimAyari: ek.sessiz ? { sessizBaslangic: "00:00", sessizBitis: "23:59" } : null } }];
    const isaretle = vi.fn(async () => ({ count: 1 }));
    const tx = { bildirimTercihi: { findMany: async () => (ek.tercih === false ? [] : [{ userId: "u1", tur: "donem" }]) }, bildirimTeslimati: { findMany: async () => adaylar, updateMany: isaretle } };
    const prisma = { tenantIslem: async (_t: string, f: (t: typeof tx) => unknown) => f(tx) };
    return { servis: new BildirimEpostaService(prisma as never, {} as never, sms as never), sms, isaretle };
  };
  it("tercih açıksa gider, tek anahtarla ve firma hesabından", async () => {
    const { servis, sms, isaretle } = kur5();
    expect(await baglamla(() => servis.kritikSmsleriGonder())).toBe(1);
    expect(isaretle).toHaveBeenCalledTimes(1);
    expect(sms.gonder).toHaveBeenCalledWith(expect.objectContaining({ anahtar: "bld:t1", tur: "kritik_bildirim", mesaj: "TekirExtra: KDV gecikti" }));
  });
  it("tercih yoksa ya da sessiz saatteyse gitmez, işaretlenmez", async () => {
    const a = kur5({ tercih: false }); expect(await baglamla(() => a.servis.kritikSmsleriGonder())).toBe(0); expect(a.sms.gonder).not.toHaveBeenCalled();
    const b = kur5({ sessiz: true }); expect(await baglamla(() => b.servis.kritikSmsleriGonder())).toBe(0); expect(b.isaretle).not.toHaveBeenCalled();
  });
  it("SMS hatası taramayı durdurmaz", async () => {
    const { servis } = kur5({ hata: true });
    await expect(baglamla(() => servis.kritikSmsleriGonder())).resolves.toBe(0);
  });
});

describe("tek çıkış (ILT-01)", () => {
  const izinli = new Set(["ileti/platform-ileti.service.ts", "tenant/eposta.service.ts"]);
  const dosyalar = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((g) => g.isDirectory() ? dosyalar(join(d, g.name)) : g.name.endsWith(".ts") && !g.name.endsWith(".test.ts") ? [join(d, g.name)] : []);
  it("SMS sağlayıcısı yalnız merkezi servisten çağrılır", () => {
    const kok = join(__dirname, "..");
    const ihlal = dosyalar(kok).map((f) => f.slice(kok.length + 1)).filter((f) => f !== "ileti/sms-saglayici.ts" && /new NetgsmAdapter\(/.test(readFileSync(join(kok, f), "utf8")));
    expect(ihlal).toEqual([]);
  });
  it("nodemailer yalnız merkezi serviste açılır", () => {
    const kok = join(__dirname, "..");
    const ihlal = dosyalar(kok).map((f) => f.slice(kok.length + 1)).filter((f) => !izinli.has(f) && /createTransport\(/.test(readFileSync(join(kok, f), "utf8")));
    expect(ihlal).toEqual([]);
  });
});
