import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PlatformPaketService } from "../src/mevzuat/platform-paket.service";
import { ABONELIK_PLANLARI } from "../src/tenant/abonelik.service";
import { abonelikTutari } from "../src/abonelik-odeme/abonelik-tutari";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const service = new PlatformPaketService({ db } as never);
const kisi = randomUUID(), firma = randomUUID(), kod = `kabul_${randomUUID().slice(0, 8)}`;
const icerik = { ad: "Kabul paketi", aciklama: "Paket tanımı", ozellikler: ["Birinci özellik"], siralama: 40 };
const fiyatlandirma = { paraBirimi: "TRY" as const, vergiDahil: false as const, kdvOrani: "20", gecerlilikTarihi: "2026-12-01", donemler: [{ aySayisi: 12 as const, matrah: "9990.00" }] };
const yonetici = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: kisi, eposta: "test@example.invalid", rol: "yonetici" }, is);
let paket: string, ilk: string, ikinci: string;
beforeAll(async () => {
  await admin.platformKullanici.create({ data: { id: kisi, eposta: `${kisi}@example.invalid`, adSoyad: "Katalog kabul", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
  await admin.tenant.create({ data: { id: firma, unvan: "Mevcut abonelik kanıtı", vkn: firma.replaceAll("-", "").slice(0, 10) } });
  await admin.tenantAbonelik.create({ data: { tenantId: firma, planKodu: "v1", durum: "aktif", donemSonu: new Date("2027-01-01T00:00:00Z") } });
});
afterAll(async () => {
  await admin.mevzuatOlay.deleteMany({ where: { kullaniciId: kisi } });
  await admin.platformKullanici.deleteMany({ where: { id: kisi } });
  await admin.tenant.deleteMany({ where: { id: firma } });
  await admin.platformFirmaYasamOlayi.deleteMany({ where: { tenantId: firma } });
  await Promise.all([admin.$disconnect(), db.$disconnect(), app.$disconnect()]);
});
describe("paket tanımı ve sürüm kataloğu — gerçek PostgreSQL", () => {
  it("mevcut üç tanım kaynakla aynı aktarılır; v1 ayrı paket olarak üretilmez", async () => {
    for (const eski of ABONELIK_PLANLARI) {
      const p = await db.platformPaket.findUniqueOrThrow({ where: { kod: eski.kod } });
      const r = await yonetici(() => service.getir(p.id));
      expect(r.surumler.find((s) => s.surumNo === 1)).toMatchObject({ surumNo: 1, durum: "yayinlandi", ad: eski.ad, aciklama: eski.aciklama, ozellikler: [...eski.ozellikler] });
      expect(r.surumler.find((s) => s.surumNo === 1)?.fiyatlandirma).toBeNull();
      expect(r.mevcutKosullar).toMatchObject({ aylikFiyat: eski.aylikFiyat, limitler: eski.limitler });
      expect(r.satisEntegrasyonu).toBe(false);
    }
    expect(await db.platformPaket.findUnique({ where: { kod: "v1" } })).toBeNull();
  });
  it("yeni paket tek taslakla ve denetim kaydıyla açılır; kod çakışması çoğaltmaz", async () => {
    const r = await yonetici(() => service.olustur({ kod, ...icerik })); paket = r.id; ilk = r.surum.id;
    expect(r.surum).toMatchObject({ surumNo: 1, kilitSurumu: 1, durum: "taslak" });
    await expect(yonetici(() => service.olustur({ kod, ...icerik }))).rejects.toThrow("zaten kullanılıyor");
    expect(await admin.mevzuatOlay.count({ where: { kullaniciId: kisi, olay: "paket_olusturuldu" } })).toBe(1);
    expect((await yonetici(() => service.getir(paket))).mevcutKosullar).toBeNull();
  });
  it("eşzamanlı güncellemeden yalnız biri kazanır; eski revizyon yayınlanamaz", async () => {
    const sonuclar = await Promise.allSettled(["Birinci", "İkinci"].map((ad) => yonetici(() => service.guncelle(paket, ilk, { ...icerik, ad, kilitSurumu: 1 }))));
    expect(sonuclar.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(sonuclar.filter((s) => s.status === "rejected")).toHaveLength(1);
    await expect(yonetici(() => service.yayinla(paket, ilk, 1))).rejects.toThrow("başka biri");
    expect((await yonetici(() => service.getir(paket))).surumler[0].kilitSurumu).toBe(2);
  });
  it("yayın içeriği API ve DB'de değiştirilemez; fiziksel silme ve kimlik değişimi kapalıdır", async () => {
    const once = await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: firma } });
    const fiyat = abonelikTutari("v1", 12)?.toplam.toFixed(2);
    const r = await yonetici(() => service.yayinla(paket, ilk, 2));
    expect(r).toMatchObject({ durum: "yayinlandi", kilitSurumu: 3 });
    await expect(yonetici(() => service.guncelle(paket, ilk, { ...icerik, kilitSurumu: 3 }))).rejects.toThrow("Yalnız taslak");
    await expect(db.$executeRaw`UPDATE platform_paket_surumleri SET ad = 'Sessiz değişiklik', kilit_surumu = kilit_surumu + 1 WHERE id = ${ilk}::uuid`).rejects.toThrow("Yayinlanmis");
    await expect(db.$executeRaw`DELETE FROM platform_paket_surumleri WHERE id = ${ilk}::uuid`).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE platform_paketler SET kod = 'degisti' WHERE id = ${paket}::uuid`).rejects.toThrow();
    expect(await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: firma } })).toEqual(once);
    expect(abonelikTutari("v1", 12)?.toplam.toFixed(2)).toBe(fiyat);
  });
  it("yarışan kopyalamalar tek ardışık taslak açar; arşiv geçmişi korunur", async () => {
    const sonuc = await Promise.allSettled([1, 2].map(() => yonetici(() => service.taslakAc(paket, ilk))));
    expect(sonuc.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const d = (await yonetici(() => service.getir(paket))).surumler[0]; ikinci = d.id;
    expect(d).toMatchObject({ surumNo: 2, durum: "taslak", kilitSurumu: 1 });
    const arsiv = await yonetici(() => service.arsivle(paket, ilk, 3));
    expect(arsiv.durum).toBe("arsiv");
    await expect(db.$executeRaw`UPDATE platform_paket_surumleri SET durum = 'yayinlandi', arsivlendi_at = NULL, kilit_surumu = kilit_surumu + 1 WHERE id = ${ilk}::uuid`).rejects.toThrow("Yayinlanmis");
    const tarih = await yonetici(() => service.getir(paket));
    expect(tarih.toplam).toBe(2); expect(tarih.surumler.find((s) => s.id === ilk)?.ad).toBe(d.ad);
  });
  it("özelliksiz taslak yayınlanamaz; yanlış paketin sürümüne müdahale edilmez", async () => {
    const yeni = await yonetici(() => service.guncelle(paket, ikinci, { ...icerik, ozellikler: [], kilitSurumu: 1 }));
    await expect(yonetici(() => service.yayinla(paket, ikinci, yeni.kilitSurumu))).rejects.toThrow("en az bir özellik");
    const baslangic = await db.platformPaket.findUniqueOrThrow({ where: { kod: "baslangic" } });
    await expect(yonetici(() => service.yayinla(baslangic.id, ikinci, yeni.kilitSurumu))).rejects.toThrow("bulunamadı");
  });
  it("kod/ad araması ve boş ileri sayfada toplam korunur; bilinmeyen paket 404 alır", async () => {
    expect(await yonetici(() => service.listele({ arama: kod, sayfa: 1 }))).toMatchObject({ toplam: 1, kayitlar: [{ id: paket }] });
    expect(await yonetici(() => service.listele({ arama: kod, sayfa: 100 }))).toMatchObject({ toplam: 1, kayitlar: [] });
    expect(await yonetici(() => service.getir(paket, 100))).toMatchObject({ toplam: 2, surumler: [] });
    await expect(yonetici(() => service.getir(randomUUID()))).rejects.toThrow("Paket bulunamadı");
  });
  it("25'ten fazla pakette bütün sonuçlara kararlı sıralamayla ulaşılır", async () => {
    const prefix = `liste_${randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 27; i++) await db.platformPaket.create({ data: { kod: `${prefix}_${String(i).padStart(2, "0")}`, surumler: { create: { ...icerik, ad: `Sayfalama ${i}`, surumNo: 1 } } } });
    const a = await yonetici(() => service.listele({ arama: prefix, sayfa: 1 }));
    const b = await yonetici(() => service.listele({ arama: prefix, sayfa: 2 }));
    expect(a.toplam).toBe(27); expect(b.toplam).toBe(27); expect(a.kayitlar).toHaveLength(25); expect(b.kayitlar).toHaveLength(2);
    expect(new Set([...a.kayitlar, ...b.kayitlar].map((p) => (p as { id: string }).id)).size).toBe(27);
    expect((a.kayitlar[0] as { kod: string }).kod).toBe(`${prefix}_00`);
    expect((b.kayitlar[1] as { kod: string }).kod).toBe(`${prefix}_26`);
  });
  it("denetim hatası değişikliği atomik geri alır", async () => {
    const once = await db.platformPaketSurumu.findUniqueOrThrow({ where: { id: ikinci } });
    await admin.$executeRawUnsafe(`CREATE FUNCTION test_paket_denetim_reddet() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.olay = 'paket_taslagi_guncellendi' THEN RAISE EXCEPTION 'paket_denetim_hatasi'; END IF; RETURN NEW; END $$`);
    await admin.$executeRawUnsafe(`CREATE TRIGGER test_paket_denetim_reddet BEFORE INSERT ON mevzuat_olaylari FOR EACH ROW EXECUTE FUNCTION test_paket_denetim_reddet()`);
    try { await expect(yonetici(() => service.guncelle(paket, ikinci, { ...icerik, ad: "Geri alınmalı", kilitSurumu: once.kilitSurumu }))).rejects.toThrow("paket_denetim_hatasi"); }
    finally { await admin.$executeRawUnsafe(`DROP TRIGGER test_paket_denetim_reddet ON mevzuat_olaylari`); await admin.$executeRawUnsafe(`DROP FUNCTION test_paket_denetim_reddet()`); }
    expect(await db.platformPaketSurumu.findUniqueOrThrow({ where: { id: ikinci } })).toEqual(once);
  });
  it("sürüm fiyatı kaydedilir, eski istemcide korunur; boşaltma açık null gerektirir", async () => {
    const r = await yonetici(() => service.olustur({ kod: `fiyat_${randomUUID().slice(0, 8)}`, ...icerik, fiyatlandirma }));
    expect(r.surum.fiyatlandirma).toEqual(fiyatlandirma);
    const g = await yonetici(() => service.guncelle(r.id, r.surum.id, { ...icerik, kilitSurumu: 1 }));
    expect(g.fiyatlandirma).toEqual(fiyatlandirma);
    const olay = await admin.mevzuatOlay.findFirstOrThrow({ where: { kullaniciId: kisi, olay: "paket_taslagi_guncellendi", detay: { path: ["surumId"], equals: r.surum.id } } });
    expect(olay.detay).toMatchObject({ onceki: { fiyatlandirma }, yeni: { fiyatlandirma } });
    const bos = await yonetici(() => service.guncelle(r.id, r.surum.id, { ...icerik, kilitSurumu: 2, fiyatlandirma: null }));
    expect(bos.fiyatlandirma).toBeNull();
  });
  it("yayınlanan fiyat arşivlenirken değiştirilemez; yeni taslağa eksiksiz kopyalanır", async () => {
    const once = await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: firma } });
    const r = await yonetici(() => service.olustur({ kod: `fiyat_${randomUUID().slice(0, 8)}`, ...icerik, fiyatlandirma }));
    const y = await yonetici(() => service.yayinla(r.id, r.surum.id, 1));
    expect(y.fiyatlandirma).toEqual(fiyatlandirma);
    await expect(db.$executeRaw`UPDATE platform_paket_surumleri SET fiyatlandirma = NULL, durum = 'arsiv', arsivlendi_at = CURRENT_TIMESTAMP, kilit_surumu = kilit_surumu + 1 WHERE id = ${y.id}::uuid`).rejects.toThrow("Yayinlanmis paket fiyati");
    const kopya = await yonetici(() => service.taslakAc(r.id, y.id));
    expect(kopya.fiyatlandirma).toEqual(fiyatlandirma);
    expect((await yonetici(() => service.arsivle(r.id, y.id, 2))).fiyatlandirma).toEqual(fiyatlandirma);
    expect(await admin.tenantAbonelik.findUniqueOrThrow({ where: { tenantId: firma } })).toEqual(once);
    expect(abonelikTutari("v1", 12)?.toplam.toFixed(2)).toBe("14385.60");
  });
  it("doğrudan DB yazımında bozuk fiyatlar reddedilir", async () => {
    const r = await yonetici(() => service.olustur({ kod: `fiyat_${randomUUID().slice(0, 8)}`, ...icerik }));
    const hatalilar = [null, [], {}, { ...fiyatlandirma, paraBirimi: "USD" }, { ...fiyatlandirma, kdvOrani: "NaN" },
      { ...fiyatlandirma, kdvOrani: "101" }, { ...fiyatlandirma, gecerlilikTarihi: "2026-02-30" },
      { ...fiyatlandirma, donemler: [fiyatlandirma.donemler[0], fiyatlandirma.donemler[0]] },
      { ...fiyatlandirma, donemler: [{ aySayisi: 12, matrah: "-1" }] },
      { ...fiyatlandirma, donemler: [{ aySayisi: 12, matrah: "1.001" }] },
      { ...fiyatlandirma, donemler: [{ aySayisi: "12", matrah: "1.00" }] },
      { ...fiyatlandirma, fazladan: true }];
    for (const hatali of hatalilar) {
      await expect(db.$executeRaw`UPDATE platform_paket_surumleri SET fiyatlandirma = ${JSON.stringify(hatali)}::jsonb, kilit_surumu = kilit_surumu + 1 WHERE id = ${r.surum.id}::uuid`).rejects.toThrow();
    }
    expect((await db.platformPaketSurumu.findUniqueOrThrow({ where: { id: r.surum.id } })).kilitSurumu).toBe(1);
  });
  it("fiyat değişikliğinde eski revizyon ve denetim hatası yazımı engeller", async () => {
    const r = await yonetici(() => service.olustur({ kod: `fiyat_${randomUUID().slice(0, 8)}`, ...icerik, fiyatlandirma }));
    await expect(yonetici(() => service.guncelle(r.id, r.surum.id, { ...icerik, kilitSurumu: 2, fiyatlandirma: null }))).rejects.toThrow("başka biri");
    await admin.$executeRawUnsafe(`CREATE FUNCTION test_fiyat_denetim_reddet() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.olay = 'paket_taslagi_guncellendi' THEN RAISE EXCEPTION 'fiyat_denetim_hatasi'; END IF; RETURN NEW; END $$`);
    await admin.$executeRawUnsafe(`CREATE TRIGGER test_fiyat_denetim_reddet BEFORE INSERT ON mevzuat_olaylari FOR EACH ROW EXECUTE FUNCTION test_fiyat_denetim_reddet()`);
    try { await expect(yonetici(() => service.guncelle(r.id, r.surum.id, { ...icerik, kilitSurumu: 1, fiyatlandirma: null }))).rejects.toThrow("fiyat_denetim_hatasi"); }
    finally { await admin.$executeRawUnsafe(`DROP TRIGGER test_fiyat_denetim_reddet ON mevzuat_olaylari`); await admin.$executeRawUnsafe(`DROP FUNCTION test_fiyat_denetim_reddet()`); }
    expect(await db.platformPaketSurumu.findUniqueOrThrow({ where: { id: r.surum.id } })).toEqual(r.surum);
  });
  it("editör ve kiracı erişemez; pasife alınan yönetici yazamaz", async () => {
    await platformBaglamiylaCalistir({ kullaniciId: kisi, eposta: "test@example.invalid", rol: "mevzuat_editoru" }, async () => {
      await expect(service.listele({ arama: "", sayfa: 1 })).rejects.toThrow("yöneticisi");
      await expect(service.getir(paket)).rejects.toThrow("yöneticisi");
      await expect(service.olustur({ kod: "editor_paketi", ...icerik })).rejects.toThrow("yöneticisi");
    });
    await expect(app.$queryRaw`SELECT * FROM platform_paketler`).rejects.toThrow();
    await expect(app.$queryRaw`SELECT * FROM platform_paket_surumleri`).rejects.toThrow();
    await admin.platformKullanici.update({ where: { id: kisi }, data: { aktif: false } });
    await expect(yonetici(() => service.guncelle(paket, ikinci, { ...icerik, kilitSurumu: 2 }))).rejects.toThrow("aktif ve kurulumu");
  });
});
