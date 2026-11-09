import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hataMetni, iletiSorunlari, smtpHataSinifi } from "./ileti-kurallari";
import { odemeBaglantisiSmsMetni, smsParcaSayisi, sozSmsMetni, telefonE164, vadeSmsMetni } from "./sms-kurallari";
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
  const kur2 = (firmaAyari: unknown) => {
    gidenFirma.length = 0; kayitlar.length = 0;
    const transport = { sendMail: async (m: Record<string, unknown>) => { const h = sira.shift(); if (h) throw h; gidenFirma.push(m); return { messageId: "mid" }; } };
    const tx = { modulAyar: { findUnique: async () => (firmaAyari ? { ayarlar: firmaAyari } : null) }, tenant: { findUnique: async () => ({ eposta: "firma@ornek.co" }) }, epostaGonderim: { create: async ({ data }: { data: Record<string, unknown> }) => { kayitlar.push(data); } } };
    const prisma = { tenantIslem: async (_t: string, f: (t: typeof tx) => unknown) => f(tx) };
    const ileti = { tasiyici: vi.fn(async () => ({ transport, from: "TekirExtra <p@t.co>", replyTo: undefined })), gonder: vi.fn(async () => ({ gonderildi: true })) };
    return { servis: new EpostaService(prisma as never, ileti as never), ileti };
  };
  beforeEach(() => { sira = []; });
  afterEach(() => { vi.useRealTimers(); });
  it("sistem iletisi firma bağlamı olsa da platformdan çıkar", async () => {
    const { servis, ileti } = kur2({ host: "smtp.firma.co" });
    await baglamla(() => servis.parolaSifirlamaGonder("u@x.co", "Ali", "http://l", 30));
    expect(ileti.gonder).toHaveBeenCalledWith(expect.objectContaining({ tur: "parola_sifirlama", alicilar: ["u@x.co"], tenantId: "t1" }));
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
    const m = vadeSmsMetni({ firma: "ACME", unvan: "B".repeat(80), toplam: "1.000,00 TL", ihtar: false });
    expect(m).toContain("ACME"); expect(m).toContain("1.000,00 TL"); expect(m.length).toBeLessThan(200);
    expect(vadeSmsMetni({ firma: "A", unvan: "B", toplam: "1 TL", ihtar: true })).toContain("ihtar");
    expect(sozSmsMetni({ firma: "ACME", unvan: "B", tutar: "5 TRY" })).toContain("ACME");
    expect(odemeBaglantisiSmsMetni({ unvan: "B", link: "https://l", faturaIcin: true })).toContain("https://l");
  });
});

describe("SMS gönderimi (ILT-10)", () => {
  process.env.BAGLANTI_SIFRELEME_ANAHTARI ??= "0".repeat(64);
  afterEach(() => { vi.restoreAllMocks(); delete process.env.SMS_GUNLUK_TAVAN; });
  const kur3 = (b: { baglanti?: boolean; bugun?: number; anahtarVar?: boolean } = {}) => {
    const satirlar: Record<string, unknown>[] = [];
    const tx = {
      $queryRaw: async () => [],
      smsGonderim: {
        findUnique: async () => (b.anahtarVar ? { id: "e" } : null),
        count: async () => b.bugun ?? 0,
        create: async ({ data }: { data: Record<string, unknown> }) => { const k = { id: `s${satirlar.length + 1}`, ...data }; satirlar.push(k); return k; },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(satirlar.find((s) => s.id === where.id)!, data),
      },
      baglanti: { findFirst: async () => (b.baglanti === false ? null : { saglayici: "netgsm", sifreliConfig: sifrele(JSON.stringify({ kullaniciAdi: "u", parola: "p", gondericiAdi: "ACME" })) }) },
    };
    return { servis: new SmsService({ tenantIslem: async (_t: string, f: (t: typeof tx) => unknown) => f(tx) } as never), satirlar };
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
  it("günlük tavan aşılmaz", async () => {
    process.env.SMS_GUNLUK_TAVAN = "3";
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
    const ihlal = dosyalar(kok).map((f) => f.slice(kok.length + 1)).filter((f) => f !== "ileti/sms.service.ts" && /new NetgsmAdapter\(/.test(readFileSync(join(kok, f), "utf8")));
    expect(ihlal).toEqual([]);
  });
  it("nodemailer yalnız merkezi serviste açılır", () => {
    const kok = join(__dirname, "..");
    const ihlal = dosyalar(kok).map((f) => f.slice(kok.length + 1)).filter((f) => !izinli.has(f) && /createTransport\(/.test(readFileSync(join(kok, f), "utf8")));
    expect(ihlal).toEqual([]);
  });
});
