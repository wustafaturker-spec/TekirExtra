import { kabulPaketleri } from "./platform-paket-fixture";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bugunTR } from "@tekirextra/shared";
import { gunEkle, istatistikFiltreSemasi } from "../src/mevzuat/platform-istatistik-filtre";
import { PlatformIstatistikService } from "../src/mevzuat/platform-istatistik.service";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";

const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const paketler = kabulPaketleri(admin, db);
const service = new PlatformIstatistikService({ db } as never);
const ids = Array.from({ length: 28 }, () => randomUUID());
const [a, b] = ids, aktor = randomUUID(), plan = `op_${randomUUID().slice(0, 8)}`;
const gun = (n: number) => gunEkle(bugunTR(), n);
type Rapor = {
  olcumBaslangici: string | null; donemSonu: Record<string, number> | null; oncekiDonemSonu: Record<string, number> | null;
  gunler: { gun: string; hazir: boolean; gecici: boolean; sayilar: Record<string, number> | null }[];
  detay: { gun: string; toplam: number | null; hazir: boolean; sayilar: Record<string, number> | null; kayitlar: { tenantId: string; unvan: string | null; toplam: number; planKodu: string }[] };
};
async function rapor(n = -1, sayfa = 1, firma: string | null = null, paket: string | null = plan) {
  const [r] = await db.$queryRaw<{ veri: Rapor }[]>`SELECT platform_operasyon_gecmisi(${gun(-3)}::date, ${gun(0)}::date, ${paket}::text, ${firma}::uuid, ${gun(n)}::date, ${sayfa}::integer) AS veri`;
  return r.veri;
}
async function kopyala(n: number) {
  await admin.$executeRaw`INSERT INTO platform_operasyon_ozetleri SELECT ${gun(n)}::date, tenant_id, plan_kodu, durum, geciken, yaklasan, baglanti_hatali, gorev, fatura, iade, hatali FROM platform_operasyon_ozetleri WHERE gun = ${gun(0)}::date`;
  await admin.$executeRaw`INSERT INTO platform_operasyon_gunleri SELECT ${gun(n)}::date, gozlem_at + make_interval(days => ${n}::integer), firma_adet, surum FROM platform_operasyon_gunleri WHERE gun = ${gun(0)}::date`;
}
beforeAll(async () => {
  await admin.platformKullanici.create({ data: { id: aktor, eposta: `${aktor}@example.invalid`, adSoyad: "Operasyon", parolaHash: "x", totpSecretSifreli: "x" } });
  for (const id of ids) {
    await admin.tenant.create({ data: { id, unvan: `OPERASYON-${id}`, vkn: id.replaceAll("-", "").slice(0, 10) } });
    await paketler.olustur( { tenantId: id, planKodu: plan, durum: "aktif", donemSonu: new Date(`${gun(3)}T12:00:00+03:00`) });
  }
  for (const durum of ["acik", "devam_ediyor", "tamamlandi", "iptal"] as const) await admin.platformGorev.create({ data: { tenantId: a, kapsam: "platform", durum, baslik: "GIZLI-GOREV", olusturanId: aktor } });
  await admin.platformGorev.create({ data: { tenantId: a, kapsam: "platform", durum: "acik", baslik: "GELECEK", olusturanId: aktor, createdAt: new Date(`${gun(1)}T12:00:00Z`) } });
  let odemeId = "";
  for (const durum of ["bekliyor", "hata", "kesinlesti", "taslak", "tahsil_edildi"]) {
    const p = await admin.abonelikOdemesi.create({ data: { tenantId: a, aySayisi: 1, tutar: 100, yeniDonemSonu: new Date(`${gun(30)}T00:00:00Z`), kaynak: "saglayici" } });
    odemeId = p.id;
    await admin.abonelikFaturasi.create({ data: { odemeId, odeyenTenantId: a, faturalayanTenantId: b, durum, hata: "GIZLI-HATA" } });
  }
  for (const durum of ["bekliyor", "hata", "yazildi", "gerekmiyor"]) await admin.abonelikIadesi.create({ data: { tenantId: a, odemeId, tutar: 1, neden: "GIZLI-IADE", islemAnahtari: randomUUID(), faturalayanDurumu: durum } });
  await service.operasyonGozle();
  await kopyala(-1); await kopyala(-3); await kopyala(-4);
});
afterAll(async () => {
  await admin.platformGorev.deleteMany({ where: { olusturanId: aktor } });
  await admin.tenant.deleteMany({ where: { id: { in: ids } } });
  await admin.platformFirmaYasamOlayi.deleteMany({ where: { tenantId: { in: ids } } });
  await admin.platformOperasyonOzeti.deleteMany({ where: { tenantId: { in: ids } } });
  await admin.platformKullanici.delete({ where: { id: aktor } });
  await Promise.all([admin.$disconnect(), db.$disconnect(), app.$disconnect()]);
});
describe("tarihsel operasyon gözlemleri — gerçek PostgreSQL", () => {
  it("görev/fatura/iade canlı kapsamla uzlaşır; yeniden gözlem sayıları çoğaltmaz", async () => {
    const ilk = await rapor(0, 1, a);
    expect(ilk.detay.sayilar).toMatchObject({ firma: 1, aktif: 1, yaklasan: 1, gorev: 2, fatura: 3, iade: 2, hatali: 2, toplam: 7 });
    const [canli] = await db.$queryRaw<{ veri: { sayilar: unknown } }[]>`SELECT platform_bekleyen_isler(${plan}::text, ${a}::uuid, 'hepsi', 1) AS veri`;
    expect(ilk.detay.sayilar).toMatchObject(canli.veri.sayilar as object);
    await service.operasyonGozle();
    expect((await rapor(0, 1, a)).detay.sayilar).toEqual(ilk.detay.sayilar);
    expect((await rapor(-1, 1, b)).detay.sayilar?.fatura).toBe(0);
  });
  it("ölçülmeyen gün null; gerçek boş paket sıfır; tam gün tablosu ve eşit dönem sonu ayrıdır", async () => {
    const r = await rapor(-2);
    expect(r.gunler).toHaveLength(4); expect(r.detay.toplam).toBeNull(); expect(r.detay.sayilar).toBeNull();
    expect(r.gunler.find((g) => g.gun === gun(-2))).toMatchObject({ hazir: false, sayilar: null });
    expect(r.gunler.at(-1)?.gecici).toBe(true); expect(r.oncekiDonemSonu).toMatchObject({ firma: 28, toplam: 7 });
    expect((await rapor(-1, 1, null, "olmayan")).detay.sayilar).toMatchObject({ firma: 0, toplam: 0 });
  });
  it("özet, toplam ve sayfalı firma ayrıntıları aynı tarihsel kaynaktan gelir", async () => {
    const r = await rapor(-1), s = await rapor(-1, 2), bos = await rapor(-1, 100);
    expect(r.detay.toplam).toBe(28); expect(r.detay.kayitlar).toHaveLength(25); expect(s.detay.kayitlar).toHaveLength(3);
    expect(new Set([...r.detay.kayitlar, ...s.detay.kayitlar].map((f) => f.tenantId)).size).toBe(28);
    expect([...r.detay.kayitlar, ...s.detay.kayitlar].reduce((t, f) => t + f.toplam, 0)).toBe(r.detay.sayilar?.toplam);
    expect(bos.detay.toplam).toBe(28); expect(bos.detay.kayitlar).toEqual([]);
  });
  it("kapanan işler, değişen paket ve silinen firma geçmiş gözlemi bozmaz", async () => {
    await admin.platformGorev.updateMany({ where: { tenantId: a }, data: { durum: "tamamlandi" } });
    await admin.abonelikFaturasi.updateMany({ where: { odeyenTenantId: a }, data: { durum: "tahsil_edildi" } });
    await admin.abonelikIadesi.updateMany({ where: { tenantId: a }, data: { faturalayanDurumu: "yazildi" } });
    await paketler.gecir(a, `${plan}_yeni`);
    await admin.tenantAbonelik.update({ where: { tenantId: a }, data: { durum: "askida" } });
    await admin.tenant.delete({ where: { id: b } });
    await service.operasyonGozle();
    expect((await rapor(-1, 1, a)).detay.sayilar?.toplam).toBe(7);
    expect((await rapor(0, 1, a)).detay.toplam).toBe(0);
    expect((await rapor(0, 1, a, `${plan}_yeni`)).detay.sayilar).toMatchObject({ askida: 1, toplam: 0 });
    expect((await rapor(-1, 1, b)).detay.kayitlar[0]).toMatchObject({ unvan: null, planKodu: plan });
  });
  it("eksik firma satırı veya eski sürüm geçersiz gün üretir; filtre eksikliği gizlemez", async () => {
    await admin.$executeRaw`DELETE FROM platform_operasyon_ozetleri WHERE gun = ${gun(-3)}::date AND tenant_id = ${b}::uuid`;
    expect((await rapor(-3, 1, a)).detay.sayilar).toBeNull();
    await admin.$executeRaw`UPDATE platform_operasyon_gunleri SET surum = 0 WHERE gun = ${gun(-3)}::date`;
    expect((await rapor(-3)).detay.hazir).toBe(false);
  });
  it("yarışan worker gözlemi kilit altında atlar; sonraki çalışma tamamlanır", async () => {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('platform-operasyon-gozlem', 0))`;
      expect(await service.operasyonGozle()).toBe(false);
    });
    expect(await service.operasyonGozle()).toBe(true);
  });
  it("işaretçi yazımı hata verirse firma özetleri ve işaretçi atomik geri alınır", async () => {
    const once = (await rapor(0, 1, a, null)).detay.sayilar;
    const yeniGorev = await admin.platformGorev.create({ data: { tenantId: a, kapsam: "platform", durum: "acik", baslik: "Geri alma kanıtı", olusturanId: aktor } });
    await admin.$executeRawUnsafe(`CREATE FUNCTION test_operasyon_reddet() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test_operasyon_hata'; END $$`);
    await admin.$executeRawUnsafe(`CREATE TRIGGER test_operasyon_reddet BEFORE INSERT OR UPDATE ON platform_operasyon_gunleri FOR EACH ROW EXECUTE FUNCTION test_operasyon_reddet()`);
    try { await expect(service.operasyonGozle()).rejects.toThrow("test_operasyon_hata"); }
    finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER test_operasyon_reddet ON platform_operasyon_gunleri`);
      await admin.$executeRawUnsafe(`DROP FUNCTION test_operasyon_reddet()`);
    }
    expect((await rapor(0, 1, a, null)).detay.sayilar).toEqual(once);
    await admin.platformGorev.delete({ where: { id: yeniGorev.id } });
  });
  it("API dar yanıt verir; editör ve kiracı ham kayıtlara/işlevlere erişemez", async () => {
    const filtre = istatistikFiltreSemasi.parse({ baslangic: gun(-3), bitis: gun(0), operasyonGun: gun(-1), plan, firma: a });
    await platformBaglamiylaCalistir({ kullaniciId: aktor, eposta: "test@example.invalid", rol: "yonetici" }, async () => {
      const r = await service.rapor(filtre);
      expect(r.operasyonGecmisi).toMatchObject({ detay: { sayilar: { toplam: 7 } } });
      expect(JSON.stringify(r.operasyonGecmisi)).not.toMatch(/GIZLI-|olusturan|eposta|odeyenIp/);
      await expect(service.rapor({ ...filtre, operasyonGun: gun(-4) })).rejects.toThrow("tarih aralığında");
    });
    await platformBaglamiylaCalistir({ kullaniciId: aktor, eposta: "test@example.invalid", rol: "mevzuat_editoru" }, async () => { await expect(service.rapor(filtre)).rejects.toThrow("yöneticisi"); });
    await expect(db.$queryRaw`SELECT * FROM platform_operasyon_ozetleri`).rejects.toThrow();
    await expect(app.$queryRaw`SELECT platform_operasyon_gozle()`).rejects.toThrow();
    await expect(app.$queryRaw`SELECT platform_operasyon_gecmisi(${gun(-3)}::date, ${gun(0)}::date, NULL, NULL, ${gun(-1)}::date, 1)`).rejects.toThrow();
  });
});
