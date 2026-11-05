import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Platform P0-1 / P1-1: firma genel bakışı ve abonelik işlevleri gerçek
 * PostgreSQL'de, gerçek rollerle. Platform rolü kiracı tablolarına doğrudan
 * erişemez; uygulama rolü platform işlevlerini çağıramaz.
 */
const env = resolve(__dirname, "../.env");
if (existsSync(env)) process.loadEnvFile(env);

const yonetici = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
function platformAdresi(): string {
  if (process.env.DATABASE_URL_PLATFORM) return process.env.DATABASE_URL_PLATFORM;
  // Göçün açtığı geliştirme rolü (20261009120000_mevzuat_merkezi).
  const u = new URL(process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL ?? "");
  u.username = "tekir_platform";
  u.password = "tekir_platform_dev";
  return u.toString();
}
const platform = new PrismaClient({ datasourceUrl: platformAdresi() });
const uygulama = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

const tenantId = randomUUID();
const userId = randomUUID();
const talepId = randomUUID();

beforeAll(async () => {
  await yonetici.$executeRaw`INSERT INTO tenants (id, unvan, vkn, vergi_dairesi, created_at, updated_at) VALUES (${tenantId}::uuid, 'PLATFORM KABUL FİRMASI', ${String(Date.now()).slice(-10)}, 'Test', now(), now())`;
  await yonetici.$executeRaw`INSERT INTO tenant_abonelikleri (id, tenant_id, plan_kodu, durum, created_at, updated_at) VALUES (gen_random_uuid(), ${tenantId}::uuid, 'baslangic', 'aktif', now(), now())`;
  await yonetici.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, aktif, created_at, updated_at, son_giris_at) VALUES (${userId}::uuid, ${tenantId}::uuid, ${`platform-kabul-${tenantId}@ornek.invalid`}, 'x', 'Kabul Kişi', 'yonetici', true, now(), now(), now())`;
  await yonetici.$executeRaw`INSERT INTO abonelik_talepleri (id, tenant_id, mevcut_plan, istenen_plan, isteyen_user_id) VALUES (${talepId}::uuid, ${tenantId}::uuid, 'baslangic', 'kurumsal', ${userId}::uuid)`;
});

afterAll(async () => {
  // users firmaya CASCADE bağlı değil; abonelik, talep ve geçmiş firmayla silinir.
  await yonetici.$executeRaw`DELETE FROM users WHERE tenant_id = ${tenantId}::uuid`;
  await yonetici.$executeRaw`DELETE FROM tenants WHERE id = ${tenantId}::uuid`;
  await Promise.all([yonetici.$disconnect(), platform.$disconnect(), uygulama.$disconnect()]);
});

describe("platform firma yönetimi (platform P0-1 / P1-1) — gerçek PostgreSQL", () => {
  it("özet firmayı plan, kullanıcı, son giriş ve bekleyen taleple verir", async () => {
    const [f] = await platform.$queryRaw<{ plan_kodu: string; durum: string; aktif_kullanici: bigint; son_giris: Date | null; bekleyen_talep_id: string | null; bekleyen_plan: string | null }[]>`
      SELECT * FROM platform_firma_ozeti() WHERE tenant_id = ${tenantId}::uuid`;
    expect(f).toMatchObject({ plan_kodu: "baslangic", durum: "aktif", bekleyen_talep_id: talepId, bekleyen_plan: "kurumsal" });
    expect(Number(f.aktif_kullanici)).toBe(1);
    expect(f.son_giris).toBeInstanceOf(Date);
  });

  it("platform rolü kiracı tablolarını doğrudan okuyamaz; uygulama rolü platform işlevini çağıramaz", async () => {
    await expect(platform.$queryRaw`SELECT count(*) FROM tenant_abonelikleri`).rejects.toThrow(/permission denied/);
    await expect(platform.$queryRaw`SELECT count(*) FROM abonelik_talepleri`).rejects.toThrow(/permission denied/);
    await expect(uygulama.$queryRaw`SELECT * FROM platform_firma_ozeti()`).rejects.toThrow(/permission denied/);
    await expect(uygulama.$executeRaw`SELECT platform_abonelik_guncelle(${tenantId}::uuid, 'kurumsal', NULL, 'saldırı')`).rejects.toThrow(/permission denied/);
  });

  it("eski talep onayı paket korumasını aşamaz; ret kararı tek kez kaydedilir", async () => {
    await expect(platform.$queryRaw`SELECT platform_abonelik_talebi_karar(${talepId}::uuid, true, 'onay notu', ${randomUUID()}::uuid)`).rejects.toThrow();
    await platform.$queryRaw`SELECT platform_abonelik_talebi_karar(${talepId}::uuid, false, 'Kontrollü atama gerekir', ${randomUUID()}::uuid)`;
    const [a] = await yonetici.$queryRaw<{ plan_kodu: string; durum: string; donem_sonu: Date | null }[]>`SELECT plan_kodu, durum::text, donem_sonu FROM tenant_abonelikleri WHERE tenant_id = ${tenantId}::uuid`;
    expect(a).toMatchObject({ plan_kodu: "baslangic", durum: "aktif" });
    expect(a.donem_sonu).toBeNull();
    await expect(platform.$queryRaw`SELECT platform_abonelik_talebi_karar(${talepId}::uuid, false, NULL, ${randomUUID()}::uuid)`).rejects.toThrow(/talep_bekliyor_degil/);
  });

  it("askıya alma durumu yazar ve geçmişe nedeniyle düşer", async () => {
    await platform.$executeRaw`SELECT platform_abonelik_guncelle(${tenantId}::uuid, NULL, 'askida', 'Kabul: ödeme yok')`;
    const [g] = await platform.$queryRaw<{ gecmis: { degisiklikler: { yeniDurum: string; neden: string }[]; talepler: { durum: string }[] } }[]>`SELECT platform_firma_abonelik_gecmisi(${tenantId}::uuid) AS gecmis`;
    expect(g.gecmis.degisiklikler[0]).toMatchObject({ yeniDurum: "askida", neden: "Kabul: ödeme yok" });
    expect(g.gecmis.degisiklikler).toHaveLength(1);
    expect(g.gecmis.talepler[0]).toMatchObject({ durum: "reddedildi" });
    await expect(platform.$executeRaw`SELECT platform_abonelik_guncelle(${randomUUID()}::uuid, NULL, 'askida', 'yok')`).rejects.toThrow(/firma_yok/);
  });
});
