import { kabulPaketleri } from "./platform-paket-fixture";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bugunTR } from "@tekirextra/shared";
import { PlatformIstatistikService } from "../src/mevzuat/platform-istatistik.service";
import { gunEkle, istatistikFiltreSemasi } from "../src/mevzuat/platform-istatistik-filtre";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";

const env = resolve(__dirname, "../.env"); if (existsSync(env)) process.loadEnvFile(env);
const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const service = new PlatformIstatistikService({ db } as never);
const bugun = bugunTR(), dun = gunEkle(bugun, -1);
const ids = { a: randomUUID(), b: randomUUID(), u1: randomUUID(), u2: randomUUID(), u3: randomUUID(), aktor: randomUUID() };
const olarak = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: ids.aktor, eposta: "stats@ornek.invalid", rol: "yonetici" }, is);
const rapor = (ek: Record<string, unknown> = {}) => olarak(() => service.rapor(istatistikFiltreSemasi.parse({ baslangic: dun, bitis: bugun, firma: ids.a, ...ek })));
let eskiBaslangic: Date;
beforeAll(async () => {
  eskiBaslangic = (await admin.platformIstatistikAyari.findUniqueOrThrow({ where: { id: 1 } })).baslangic;
  await admin.platformIstatistikAyari.update({ where: { id: 1 }, data: { baslangic: new Date(`${dun}T00:00:00Z`) } });
  for (const id of [ids.a, ids.b]) await admin.tenant.create({ data: { id, unvan: `ISTATISTIK-${id}`, vkn: id.replaceAll("-", "").slice(0, 10), vergiDairesi: "Test", createdAt: new Date(`${gunEkle(dun, -10)}T00:00:00Z`) } });
  await admin.tenantAbonelik.createMany({ data: [{ tenantId: ids.a, planKodu: "baslangic", durum: "aktif", donemSonu: new Date(`${gunEkle(bugun, 3)}T00:00:00Z`) }, { tenantId: ids.b, planKodu: "profesyonel", durum: "deneme" }] });
  await admin.platformKullanici.create({ data: { id: ids.aktor, eposta: `${ids.aktor}@ornek.invalid`, adSoyad: "İstatistik", parolaHash: "x", totpSecretSifreli: "x" } });
  await admin.abonelikOdemeDenemesi.createMany({ data: [
    { tenantId: ids.a, createdAt: new Date(Date.now() - 1000) },
    { tenantId: ids.a, createdAt: new Date(`${gunEkle(bugun, 1)}T12:00:00+03:00`) },
    { tenantId: ids.a, createdAt: new Date(`${gunEkle(bugun, -7)}T12:00:00+03:00`) },
    { tenantId: ids.b, createdAt: new Date(Date.now() - 1000) },
  ].map((g) => ({ ...g, saglayici: "iyzico", ortam: "test", kaynak: "panel", planKodu: "baslangic", aySayisi: 1, matrah: "1.00", kdv: "0.20", toplam: "1.20", durum: "basarisiz" })) });
  const olay = (tenantId: string, userId: string | null, islem: string, varlik: string, an: string) => ({ tenantId, userId, islem, varlik, createdAt: new Date(an), detay: { gizli: "kaynak-icerigi-donmemeli" } });
  await admin.auditLog.createMany({ data: [
    olay(ids.a, ids.u1, "giris_yapildi", "user", `${dun}T09:00:00+03:00`),
    olay(ids.a, ids.u1, "POST /api/v1/fatura", "fatura", `${dun}T10:00:00+03:00`),
    olay(ids.a, "00000000-0000-0000-0000-000000000000", "POST /api/v1/fatura", "fatura", `${dun}T10:00:00+03:00`),
    olay(ids.a, "00000000-0000-4000-8000-000000000000", "POST /api/v1/cari", "cari", `${dun}T10:00:00+03:00`),
    olay(ids.a, ids.u2, "geciken_soz_takibe_baglandi", "cari", `${dun}T10:00:00+03:00`),
    olay(ids.a, null, "POST /api/v1/fatura", "fatura", `${dun}T10:00:00+03:00`),
    olay(ids.a, ids.u1, "giris_yapildi", "user", `${bugun}T09:00:00+03:00`),
    olay(ids.a, ids.u2, "POST /api/v1/cari", "cari", `${bugun}T10:00:00+03:00`),
    olay(ids.a, ids.u1, "POST /api/v1/fatura", "fatura", `${dun}T21:00:00Z`),
    olay(ids.a, ids.u1, "GET /api/v1/fatura", "fatura", `${bugun}T09:00:00+03:00`),
    olay(ids.b, ids.u3, "POST /api/v1/stok", "stok", `${dun}T10:00:00+03:00`),
  ] });
});
afterAll(async () => {
  await admin.$executeRaw`DELETE FROM audit_log WHERE tenant_id IN (${ids.a}::uuid, ${ids.b}::uuid)`;
  await admin.$executeRaw`DELETE FROM mevzuat_olaylari WHERE kullanici_id = ${ids.aktor}::uuid`;
  await admin.platformFirmaGunlukKullanici.deleteMany({ where: { tenantId: { in: [ids.a, ids.b] } } });
  await admin.platformFirmaGunlukOzeti.deleteMany({ where: { tenantId: { in: [ids.a, ids.b] } } });
  await admin.tenant.deleteMany({ where: { id: { in: [ids.a, ids.b] } } });
  await admin.platformKullanici.delete({ where: { id: ids.aktor } });
  await admin.platformIstatistikAyari.update({ where: { id: 1 }, data: { baslangic: eskiBaslangic } });
  await Promise.all([admin.$disconnect(), db.$disconnect(), app.$disconnect()]);
});

describe("firma istatistikleri — gerçek PostgreSQL", () => {
  it("gün üretimi idempotenttir; destek/sistem/salt okuma sayılmaz, tekil kullanıcı dönem boyunca bir sayılır", async () => {
    await service.gunuUret(dun); await service.gunuUret(bugun); await service.gunuUret(bugun);
    const r = await rapor();
    expect(r.guncel.basarisizOdeme7Gun).toBe(1);
    expect(r.donem).toEqual({ etkinFirma: 1, etkinKullanici: 2, giris: 2, islem: 3 });
    expect(r.gunler).toMatchObject([{ gun: dun, etkinKullanici: 1, giris: 1, islem: 1 }, { gun: bugun, etkinKullanici: 2, giris: 1, islem: 2 }]);
    expect(r.moduller).toEqual([{ kod: "fatura", adet: 2 }, { kod: "cari", adet: 1 }]);
    expect(r.onceki.etkinFirma).toBeNull();
  });
  it("eksik gün sıfır sayılmaz; ölçümü tam fakat etkinliği olmayan gün sıfırdır", async () => {
    const bos = await rapor({ baslangic: bugun, firma: ids.b });
    expect(bos.donem).toEqual({ etkinFirma: 0, etkinKullanici: 0, giris: 0, islem: 0 });
    await admin.platformIstatistikGunu.delete({ where: { gun: new Date(`${dun}T00:00:00Z`) } });
    const eksik = await rapor();
    expect(eksik.donem.etkinKullanici).toBeNull();
    expect(eksik.gunler[0].etkinFirma).toBeNull();
    expect(eksik.olcum.eksikGunler).toEqual([dun]);
    expect(eksik.firmalar.kayitlar[0].giris).toBe(1);
    await service.gunuUret(dun);
  });
  it("geçmiş günü bugünkü paketle doldurmaz; bilinen geçmiş paket yeniden hesaplamada değişmez", async () => {
    expect((await rapor({ plan: "baslangic" })).donem.etkinFirma).toBeNull();
    await admin.platformFirmaGunlukOzeti.update({ where: { tenantId_gun: { tenantId: ids.a, gun: new Date(`${dun}T00:00:00Z`) } }, data: { planKodu: "baslangic", durum: "aktif" } });
    await kabulPaketleri(admin, db).gecir(ids.a, "kurumsal");
    await service.gunuUret(dun); await service.gunuUret(bugun);
    const eski = await rapor({ baslangic: dun, bitis: dun, plan: "baslangic" });
    expect(eski.donem.islem).toBe(1);
    expect(eski.guncel.toplam).toBe(0);
    const yeni = await rapor({ baslangic: bugun, plan: "kurumsal" });
    expect(yeni.donem.islem).toBe(2); expect(yeni.guncel.toplam).toBe(1); expect(yeni.guncel.yaklasan).toBe(1);
  });
  it("firma ayrıntıları aynı dönem ve ölçütten üretilir; boş sayfada toplam korunur", async () => {
    const r = await rapor({ olcut: "islem" });
    expect(r.firmalar.toplam).toBe(1);
    expect(r.firmalar.kayitlar[0]).toMatchObject({ tenantId: ids.a, etkinGun: 2, etkinKullanici: 2, giris: 2, islem: 3 });
    expect((await rapor({ sayfa: 2 })).firmalar).toMatchObject({ toplam: 1, kayitlar: [] });
  });
  it("yeniden hesaplama sınırları ve denetim; eşzamanlı üretim çift saymaz", async () => {
    await expect(olarak(() => service.yenidenHesapla(gunEkle(dun, -1), bugun))).rejects.toThrow("Ölçüm başlangıcından önceki");
    await Promise.all([service.gunuUret(bugun), service.gunuUret(bugun)]);
    expect((await rapor()).donem.islem).toBe(3);
    await olarak(() => service.yenidenHesapla(bugun, bugun));
    expect(await admin.mevzuatOlay.count({ where: { kullaniciId: ids.aktor, olay: "firma_istatistikleri_hesaplandi" } })).toBe(1);
    const bekleyen = await admin.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`platform-istatistik:${bugun}`}, 0))::text`;
      return olarak(() => service.yenidenHesapla(bugun, bugun));
    });
    expect(bekleyen).toMatchObject({ tamamlanan: 0, bekleyen: 1 });
    expect(bekleyen.mesaj).toContain("başka bir hesaplama sürüyor");
  });
  it("gün işaretçisi yazılamazsa özet ve tekil izler birlikte geri alınır", async () => {
    const olay = await admin.auditLog.create({ data: { tenantId: ids.a, userId: ids.u1, varlik: "cari", islem: "POST /api/v1/cari", createdAt: new Date(`${bugun}T00:00:01+03:00`) } });
    await admin.$executeRawUnsafe("ALTER TABLE platform_istatistik_gunleri ADD CONSTRAINT platform_stats_kabul_geri_al CHECK (false) NOT VALID");
    try {
      await expect(service.gunuUret(bugun)).rejects.toThrow(/platform_stats_kabul_geri_al/);
      expect((await rapor()).donem).toMatchObject({ islem: 3, etkinKullanici: 2 });
    } finally {
      await admin.$executeRawUnsafe("ALTER TABLE platform_istatistik_gunleri DROP CONSTRAINT platform_stats_kabul_geri_al");
      await admin.$executeRaw`DELETE FROM audit_log WHERE id = ${olay.id}::uuid`;
    }
  });
  it("ham içerik ve kullanıcı izleri API'ye veya yetkisiz DB rolüne çıkmaz", async () => {
    const metin = JSON.stringify(await rapor());
    for (const gizli of [ids.u1, ids.u2, "kaynak-icerigi-donmemeli", "kullanici_izi", "user_id"]) expect(metin).not.toContain(gizli);
    for (const tablo of ["platform_firma_gunluk_ozetleri", "platform_firma_gunluk_kullanicilar", "platform_istatistik_gunleri"]) await expect(app.$queryRawUnsafe(`SELECT * FROM ${tablo}`)).rejects.toThrow(/permission denied/);
    await expect(db.$queryRaw`SELECT * FROM platform_firma_gunluk_kullanicilar`).rejects.toThrow(/permission denied/);
    await expect(app.$queryRaw`SELECT platform_firma_istatistik_uret(${bugun}::date)`).rejects.toThrow(/permission denied/);
    await expect(app.$queryRaw`SELECT platform_istatistik_tekil_kullanici(${dun}::date, ${bugun}::date, NULL, NULL)`).rejects.toThrow(/permission denied/);
  });
});
