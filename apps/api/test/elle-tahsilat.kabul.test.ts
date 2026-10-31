import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * PLT-09: elle tahsilat işlevleri gerçek PostgreSQL'de, gerçek rollerle.
 * Ödeme dönemi uzatır, geçmişe yazılır; 15 gün geciken firma özetde işaretlenir.
 */
const env = resolve(__dirname, "../.env");
if (existsSync(env)) process.loadEnvFile(env);

const yonetici = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
function platformAdresi(): string {
  if (process.env.DATABASE_URL_PLATFORM) return process.env.DATABASE_URL_PLATFORM;
  const u = new URL(process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL ?? "");
  u.username = "tekir_platform";
  u.password = "tekir_platform_dev";
  return u.toString();
}
const platform = new PrismaClient({ datasourceUrl: platformAdresi() });
const uygulama = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

const geciken = randomUUID();
const donemsiz = randomUUID();
const platformKullanici = randomUUID();
const ek = String(Date.now()).slice(-9);

beforeAll(async () => {
  for (const [id, vkn] of [[geciken, `1${ek}`], [donemsiz, `2${ek}`]]) {
    await yonetici.$executeRaw`INSERT INTO tenants (id, unvan, vkn, vergi_dairesi, created_at, updated_at) VALUES (${id}::uuid, 'TAHSİLAT KABUL', ${vkn}, 'Test', now(), now())`;
  }
  await yonetici.$executeRaw`INSERT INTO tenant_abonelikleri (id, tenant_id, plan_kodu, durum, donem_sonu, fatura_epostasi, created_at, updated_at) VALUES (gen_random_uuid(), ${geciken}::uuid, 'baslangic', 'aktif', now() - interval '20 days', 'fatura@kabul.invalid', now(), now())`;
  await yonetici.$executeRaw`INSERT INTO tenant_abonelikleri (id, tenant_id, plan_kodu, durum, created_at, updated_at) VALUES (gen_random_uuid(), ${donemsiz}::uuid, 'v1', 'aktif', now(), now())`;
  await yonetici.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, aktif, created_at, updated_at) VALUES (gen_random_uuid(), ${geciken}::uuid, ${`tahsilat-kabul-${ek}@ornek.invalid`}, 'x', 'Kabul', 'yonetici', true, now(), now())`;
});

afterAll(async () => {
  await yonetici.$executeRaw`DELETE FROM users WHERE tenant_id IN (${geciken}::uuid, ${donemsiz}::uuid)`;
  await yonetici.$executeRaw`DELETE FROM tenants WHERE id IN (${geciken}::uuid, ${donemsiz}::uuid)`;
  await Promise.all([yonetici.$disconnect(), platform.$disconnect(), uygulama.$disconnect()]);
});

const ozet = async (id: string) => (await platform.$queryRaw<{ askiya_alinacak: boolean; donem_sonu: Date | null; son_odeme_at: Date | null }[]>`SELECT * FROM platform_firma_ozeti() WHERE tenant_id = ${id}::uuid`)[0];

describe("elle tahsilat (PLT-09) — gerçek PostgreSQL", () => {
  it("15 gün geciken firma askıya alınacak; dönemi olmayan eski kayıt değil", async () => {
    expect((await ozet(geciken)).askiya_alinacak).toBe(true);
    expect((await ozet(donemsiz)).askiya_alinacak).toBe(false);
  });

  it("hatırlatma adayları dönemi tanımlı firmalar; fatura e-postası ve yöneticiler gelir", async () => {
    const adaylar = await platform.$queryRaw<{ tenant_id: string; fatura_epostasi: string; yonetici_epostalari: string[] }[]>`SELECT * FROM platform_tahsilat_adaylari() WHERE tenant_id IN (${geciken}::uuid, ${donemsiz}::uuid)`;
    expect(adaylar).toEqual([expect.objectContaining({ tenant_id: geciken, fatura_epostasi: "fatura@kabul.invalid", yonetici_epostalari: [`tahsilat-kabul-${ek}@ornek.invalid`] })]);
  });

  it("ödeme dönemi uzatır, durumu değiştirmez, geçmişe ve ödemelere yazılır; firma listeden çıkar", async () => {
    const once = (await ozet(geciken)).donem_sonu!;
    const [r] = await platform.$queryRaw<{ s: Date }[]>`SELECT platform_odeme_kaydet(${geciken}::uuid, 3, 1500.50, 'Havale', ${platformKullanici}::uuid, 'ekip@kabul.invalid') AS s`;
    const beklenen = new Date(once); beklenen.setUTCMonth(beklenen.getUTCMonth() + 3);
    expect(Math.abs(r.s.getTime() - beklenen.getTime())).toBeLessThan(3 * 3600_000);
    const sonra = await ozet(geciken);
    expect(sonra.askiya_alinacak).toBe(false);
    expect(sonra.son_odeme_at).toBeInstanceOf(Date);
    const [g] = await platform.$queryRaw<{ gecmis: { odemeler: { aySayisi: number; tutar: number; not: string }[]; degisiklikler: { neden: string; yeniDurum: string }[] } }[]>`SELECT platform_firma_abonelik_gecmisi(${geciken}::uuid) AS gecmis`;
    expect(g.gecmis.odemeler).toEqual([expect.objectContaining({ aySayisi: 3, tutar: 1500.5, not: "Havale" })]);
    expect(g.gecmis.degisiklikler[0]).toMatchObject({ yeniDurum: "aktif", neden: expect.stringMatching(/^Ödeme alındı \(ekip@kabul\.invalid\): 3 ay, 1.?500,50 TL; dönem sonu/) });
  });

  it("dönemi olmayan kayıtta dönem bugünden başlar; geçersiz süre ve uygulama rolü reddedilir", async () => {
    const [r] = await platform.$queryRaw<{ s: Date }[]>`SELECT platform_odeme_kaydet(${donemsiz}::uuid, 1, 0, NULL, ${platformKullanici}::uuid, 'ekip@kabul.invalid') AS s`;
    // PostgreSQL "+1 ay"ı ay sonuna kırpar (31 Ekim → 30 Kasım); JS setUTCMonth taşırdı (→ 1 Aralık).
    const ay = new Date(); const gun = ay.getUTCDate(); ay.setUTCDate(1); ay.setUTCMonth(ay.getUTCMonth() + 1);
    ay.setUTCDate(Math.min(gun, new Date(Date.UTC(ay.getUTCFullYear(), ay.getUTCMonth() + 1, 0)).getUTCDate()));
    expect(Math.abs(r.s.getTime() - ay.getTime())).toBeLessThan(24 * 3600_000);
    await expect(platform.$queryRaw`SELECT platform_odeme_kaydet(${donemsiz}::uuid, 2, 0, NULL, ${platformKullanici}::uuid, 'x')`).rejects.toThrow(/gecersiz_sure/);
    await expect(uygulama.$queryRaw`SELECT platform_odeme_kaydet(${donemsiz}::uuid, 1, 0, NULL, ${platformKullanici}::uuid, 'x')`).rejects.toThrow(/permission denied/);
    await expect(platform.$queryRaw`SELECT count(*) FROM abonelik_odemeleri`).rejects.toThrow(/permission denied/);
  });
});
