import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PAKET_MODUL_KODLARI, paketKapsamSemasi, bugunTR, type PaketKapsamSozlesmesi } from "@tekirextra/shared";
import { PrismaService } from "../src/core/prisma.service";
import { baglamlaCalistir, platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PlatformPaketService } from "../src/mevzuat/platform-paket.service";
import { AbonelikService } from "../src/tenant/abonelik.service";
import { bagliAbonelikTutari } from "../src/tenant/abonelik-kosullari";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });
const servis = new PlatformPaketService({ db } as never), kisi = randomUUID(), firma = randomUUID();
const yonetici = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: kisi, eposta: "kapsam@kabul.invalid", rol: "yonetici" }, is);
const icerik = { ad: "Kapsam kabul", aciklama: "Katalog sözleşmesi", ozellikler: ["Tanım metni"], siralama: 30 };
const fiyatlandirma = { paraBirimi: "TRY" as const, vergiDahil: false as const, kdvOrani: "20", gecerlilikTarihi: "2026-01-01", donemler: ([1, 3, 6, 12] as const).map((aySayisi) => ({ aySayisi, matrah: String(1100 * aySayisi) })) };
const kapsam = (): PaketKapsamSozlesmesi => ({ semaSurumu: 1, moduller: [...PAKET_MODUL_KODLARI], kotalar: {
  kullanici: { sinir: 0, uyariYuzdesi: 1 }, cari: { sinir: null, uyariYuzdesi: 99 }, stok: { sinir: 2147483647, uyariYuzdesi: 80 }, aylikFatura: { sinir: 100, uyariYuzdesi: 80 },
} });
let paketId: string, ilkId: string, taslakId: string;
beforeAll(async () => {
  await admin.platformKullanici.create({ data: { id: kisi, eposta: `${kisi}@kabul.invalid`, adSoyad: "Kapsam yönetici", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
  await admin.tenant.create({ data: { id: firma, unvan: "Kapsam koşulları korunacak firma", vkn: "7600000001" } });
  await admin.tenantAbonelik.create({ data: { tenantId: firma, planKodu: "v1", donemSonu: new Date(Date.now() + 2 * 86400000) } });
  const p = await db.platformPaket.findUniqueOrThrow({ where: { kod: "profesyonel" }, include: { surumler: { where: { surumNo: 1 } } } });
  paketId = p.id; ilkId = p.surumler[0].id;
});
afterAll(async () => {
  vi.useRealTimers();
  await admin.mevzuatOlay.deleteMany({ where: { kullaniciId: kisi } });
  await admin.platformPaketAtamasi.deleteMany({ where: { kullaniciId: kisi } });
  await admin.fatura.deleteMany({ where: { tenantId: firma } });
  await admin.cariHesap.deleteMany({ where: { tenantId: firma } });
  await admin.tenant.deleteMany({ where: { id: firma } });
  await admin.platformFirmaYasamOlayi.deleteMany({ where: { tenantId: firma } });
  await admin.platformKullanici.deleteMany({ where: { id: kisi } });
  await Promise.all([admin.$disconnect(), db.$disconnect(), app.$disconnect()]);
});
describe("paket erişim ve kota sözleşmesi — gerçek PostgreSQL", () => {
  it("eski yayınlar/abonelik koşulları değiştirilmez; eski istemci taslağı tanımsız açar", async () => {
    expect((await db.platformPaketSurumu.findUniqueOrThrow({ where: { id: ilkId } })).kapsamSozlesmesi).toBeNull();
    const d = await yonetici(() => servis.taslakAc(paketId, ilkId)); taslakId = d.id;
    expect(d.kapsamSozlesmesi).toBeNull();
    expect(bagliAbonelikTutari(await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: firma } }), 1)?.toplam.toFixed(2)).toBe("1198.80");
  });
  it("kapsam kaydedilir; göndermeyen istemci korur, açık null kaldırır", async () => {
    let d = await db.platformPaketSurumu.findUniqueOrThrow({ where: { id: taslakId } });
    d = await yonetici(() => servis.guncelle(paketId, taslakId, { ...icerik, kapsamSozlesmesi: kapsam(), kilitSurumu: d.kilitSurumu }));
    expect(d.kapsamSozlesmesi).toEqual(kapsam());
    d = await yonetici(() => servis.guncelle(paketId, taslakId, { ...icerik, kilitSurumu: d.kilitSurumu })); expect(d.kapsamSozlesmesi).toEqual(kapsam());
    d = await yonetici(() => servis.guncelle(paketId, taslakId, { ...icerik, kapsamSozlesmesi: null, kilitSurumu: d.kilitSurumu })); expect(d.kapsamSozlesmesi).toBeNull();
  });
  it.each([
    { moduller: [] }, { moduller: ["ayarlar"] }, { moduller: ["cari", "cari"] }, { moduller: ["ebelge", "cari"] }, { moduller: ["uretim"] },
    { semaSurumu: 2 }, { ekUcret: 10 }, { kotalar: {} },
    { kotalar: { ...kapsam().kotalar, cari: { sinir: -1, uyariYuzdesi: 80 } } },
    { kotalar: { ...kapsam().kotalar, cari: { sinir: 1.5, uyariYuzdesi: 80 } } },
    { kotalar: { ...kapsam().kotalar, cari: { sinir: 2147483648, uyariYuzdesi: 80 } } },
    { kotalar: { ...kapsam().kotalar, cari: { sinir: 1, uyariYuzdesi: 100 } } },
    { kotalar: { ...kapsam().kotalar, cari: { sinir: 1, uyariYuzdesi: 80, birim: "MB" } } },
    { ozellikler: { bilinmeyen: true } }, { ozellikler: { telegramOzelBot: "evet" } }, { ozellikler: [] },
    { moduller: ["cari"], ozellikler: { fiyatEndeksAnalizi: true } }, { moduller: ["cari"], ozellikler: { telegramOzelBot: true } },
  ])("API/DB aynı geçersiz kapsamı reddeder: %j", async (ek) => {
    const g = { ...kapsam(), ...ek }; expect(paketKapsamSemasi.safeParse(g).success).toBe(false);
    await expect(db.$executeRaw`UPDATE platform_paket_surumleri SET kapsam_sozlesmesi=${JSON.stringify(g)}::jsonb,kilit_surumu=kilit_surumu+1 WHERE id=${taslakId}::uuid`).rejects.toThrow();
    expect((await db.platformPaketSurumu.findUniqueOrThrow({ where: { id: taslakId } })).kapsamSozlesmesi).toBeNull();
  });
  it("plan özellikleri DB tetikleyicisinden geçer (CNL-19/END)", async () => {
    let d = await db.platformPaketSurumu.findUniqueOrThrow({ where: { id: taslakId } });
    const g = { ...kapsam(), ozellikler: { telegramOzelBot: true, fiyatEndeksAnalizi: false } };
    d = await yonetici(() => servis.guncelle(paketId, taslakId, { ...icerik, kapsamSozlesmesi: g, kilitSurumu: d.kilitSurumu }));
    expect(d.kapsamSozlesmesi).toEqual(g);
    d = await yonetici(() => servis.guncelle(paketId, taslakId, { ...icerik, kapsamSozlesmesi: { ...kapsam(), moduller: ["cari", "raporlar"], ozellikler: { fiyatEndeksAnalizi: true } }, kilitSurumu: d.kilitSurumu }));
    d = await yonetici(() => servis.guncelle(paketId, taslakId, { ...icerik, kapsamSozlesmesi: null, kilitSurumu: d.kilitSurumu })); expect(d.kapsamSozlesmesi).toBeNull();
  });
  it("geçerli kapsam yayımlanır, DB'de sabitlenir ve kaynak taslağa kopyalanır", async () => {
    const once = await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: firma } });
    const d = await db.platformPaketSurumu.findUniqueOrThrow({ where: { id: taslakId } });
    const g = await yonetici(() => servis.guncelle(paketId, taslakId, { ...icerik, fiyatlandirma, kapsamSozlesmesi: kapsam(), kilitSurumu: d.kilitSurumu }));
    const y = await yonetici(() => servis.yayinla(paketId, taslakId, g.kilitSurumu));
    expect(y.kapsamSozlesmesi).toEqual(kapsam());
    await expect(db.$executeRaw`UPDATE platform_paket_surumleri SET kapsam_sozlesmesi=NULL,kilit_surumu=kilit_surumu+1 WHERE id=${y.id}::uuid`).rejects.toThrow("kapsami degistirilemez");
    const kopya = await yonetici(() => servis.taslakAc(paketId, y.id)); expect(kopya.kapsamSozlesmesi).toEqual(kapsam());
    expect(await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: firma } })).toEqual(once);
  });
  it("fiyat raporu kapsamı işaretler; hemen/planlı fiyat ataması kapsamı sessizce atlayamaz", async () => {
    expect(await yonetici(() => servis.fiyatEtkisi(taslakId, 1))).toMatchObject({ hedefKapsamVar: true });
    await expect(yonetici(() => servis.atamaOnizle({ surumId: taslakId, tenantIds: [firma], uygulamaTarihi: bugunTR(), neden: "Kapsam atama kontrolü" }))).rejects.toThrow("Kapsam ataması");
    await expect(yonetici(() => servis.atamaOnizle({ surumId: taslakId, tenantIds: [firma], uygulamaTarihi: null, uygulamaTuru: "donem_sonu", neden: "Planlı kapsam kontrolü" }))).rejects.toThrow("Kapsam ataması");
    expect(await admin.platformPaketAtamasi.count({ where: { hedefSurumId: taslakId } })).toBe(0);
  });
  it("eski yayınlara kapsam eklemek ve kiracıdan katalog okumak reddedilir", async () => {
    await expect(db.$executeRaw`UPDATE platform_paket_surumleri SET kapsam_sozlesmesi=${JSON.stringify(kapsam())}::jsonb,kilit_surumu=kilit_surumu+1 WHERE id=${ilkId}::uuid`).rejects.toThrow("kapsami degistirilemez");
    await expect(app.tenantIslem(firma, (tx) => tx.platformPaketSurumu.findMany())).rejects.toThrow();
  });
  it("Türkiye ayı sayımı taslak/iptali içerir, önceki/sonraki ayı dışlar; belge tarihini kullanmaz", async () => {
    const cari = await admin.cariHesap.create({ data: { tenantId: firma, kod: "KAPSAM", unvan: "Kapsam carisi", tip: "musteri" } });
    const ortak = { tenantId: firma, cariId: cari.id, tip: "satis" as const, tarih: new Date("2025-01-01"), toplamBrut: 0, toplamSatirIskontosu: 0, genelIskontoToplam: 0, toplamMatrah: 0, toplamKdv: 0, toplamTevkifat: 0, toplamNetKdv: 0, genelToplam: 0 };
    for (const [createdAt, durum] of [["2026-10-31T20:59:59.999Z", "taslak"], ["2026-10-31T21:00:00.000Z", "taslak"], ["2026-11-10T00:00:00Z", "iptal"], ["2026-11-30T21:00:00Z", "taslak"]] as const)
      await admin.fatura.create({ data: { ...ortak, createdAt: new Date(createdAt), durum } });
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    try {
      const o = await baglamlaCalistir({ tenantId: firma, userId: kisi, rol: "yonetici" }, () => new AbonelikService(app).ozet());
      expect(o.kullanim.aylikFatura).toBe(2);
    } finally { vi.useRealTimers(); }
  });
});
