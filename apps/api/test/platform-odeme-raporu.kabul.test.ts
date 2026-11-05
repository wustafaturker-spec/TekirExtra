import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlatformPrismaService } from "../src/mevzuat/platform-prisma.service";
import { PlatformOdemeRaporuService } from "../src/abonelik-odeme/platform-odeme-raporu.service";

/**
 * PLT-32…37: ödeme raporu gerçek PostgreSQL'de, platform rolüyle. Kayıtlar
 * 2026-01'e tarihlenir: abonelik faturalama başlangıcından (2026-10-30) önce
 * oldukları için aynı veritabanındaki pilot worker bunları faturalamaz; kart
 * otomatik yenilemesi kapalıdır.
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
const servis = new PlatformOdemeRaporuService({ db: platform } as unknown as PlatformPrismaService);

const tenantId = randomUUID();
const elleId = randomUUID();
const kartliId = randomUUID();
const ekipId = randomUUID();
const unvan = `PLT-32 KABUL ${tenantId.slice(0, 8)}`;
let kaydeden = "";

beforeAll(async () => {
  await yonetici.$executeRaw`INSERT INTO tenants (id, unvan, vkn, vergi_dairesi, created_at, updated_at) VALUES (${tenantId}::uuid, ${unvan}, ${String(Date.now()).slice(-10)}, 'Test', now(), now())`;
  await yonetici.$executeRaw`INSERT INTO tenant_abonelikleri (id, tenant_id, plan_kodu, durum, donem_sonu, created_at, updated_at) VALUES (gen_random_uuid(), ${tenantId}::uuid, 'profesyonel', 'aktif', now() + interval '5 days', now(), now())`;
  // Kendi aktörünü kurar; boş kabul veritabanında da çalışır.
  kaydeden = "Ödeme raporu kabul yetkilisi";
  await yonetici.platformKullanici.create({ data: { id: ekipId, eposta: `${ekipId}@kabul.invalid`, adSoyad: kaydeden, parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
  await yonetici.$executeRaw`INSERT INTO abonelik_odemeleri (id, tenant_id, ay_sayisi, tutar, yeni_donem_sonu, kaynak, platform_kullanici_id, created_at) VALUES (${elleId}::uuid, ${tenantId}::uuid, 1, 1200.00, '2026-02-15', 'elle', ${ekipId}::uuid, '2026-01-15 09:00')`;
  await yonetici.$executeRaw`INSERT INTO abonelik_odemeleri (id, tenant_id, ay_sayisi, tutar, matrah, kdv, yeni_donem_sonu, kaynak, saglayici, created_at) VALUES (${kartliId}::uuid, ${tenantId}::uuid, 3, 3596.40, 2997.00, 599.40, '2026-05-15', 'saglayici', 'iyzico', '2026-01-20 09:00')`;
  await yonetici.$executeRaw`INSERT INTO abonelik_odeme_denemeleri (id, tenant_id, saglayici, ortam, kaynak, plan_kodu, ay_sayisi, matrah, kdv, toplam, durum, saglayici_token, odeyen_ip, abonelik_odemesi_id, created_at)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, 'iyzico', 'test', 'eposta', 'profesyonel', 3, 2997.00, 599.40, 3596.40, 'odendi', 'GIZLI-TOKEN', '203.0.113.9', ${kartliId}::uuid, '2026-01-20 08:59'),
           (gen_random_uuid(), ${tenantId}::uuid, 'iyzico', 'test', 'otomatik', 'profesyonel', 1, 999.00, 199.80, 1198.80, 'basarisiz', NULL, '203.0.113.9', NULL, '2026-01-21 09:00'),
           (gen_random_uuid(), ${tenantId}::uuid, 'paytr', 'test', 'panel', 'profesyonel', 1, 999.00, 199.80, 1198.80, 'baslatildi', 'GIZLI-TOKEN-2', '203.0.113.9', NULL, '2026-01-22 09:00')`;
  await yonetici.$executeRaw`INSERT INTO abonelik_kartlari (tenant_id, saglayici, ortam, sifreli_anahtarlar, son4, kart_markasi, otomatik_yenileme, ay_sayisi, odeyen_ip, deneme_sayisi, son_deneme_at, son_hata, created_at, updated_at)
    VALUES (${tenantId}::uuid, 'iyzico', 'test', 'GIZLI-ANAHTAR', '0006', 'MASTER_CARD', false, 3, '203.0.113.9', 2, now(), 'Yetersiz bakiye', now(), now())`;
});

afterAll(async () => {
  await yonetici.$executeRaw`DELETE FROM tenants WHERE id = ${tenantId}::uuid`;
  await yonetici.platformKullanici.deleteMany({ where: { id: ekipId } });
  await Promise.all([yonetici.$disconnect(), platform.$disconnect()]);
});

describe("PLT-32…37 — platform ödeme raporu (gerçek PostgreSQL, platform rolü)", () => {
  it("platform rolü kiracı ödeme tablolarını doğrudan okuyamaz", async () => {
    await expect(platform.$queryRaw`SELECT count(*) FROM abonelik_odemeleri`).rejects.toThrow(/permission denied/);
    await expect(platform.$queryRaw`SELECT count(*) FROM abonelik_odeme_denemeleri`).rejects.toThrow(/permission denied/);
  });

  it("liste kanalı, elle KDV ayrıştırmasını ve önceki dönemi getirir; gizli alan dönmez", async () => {
    const r = await servis.rapor("2026-01-01", "2026-01-31", { arama: unvan }, 1, 50);
    expect(r.kayitlar.map((x) => [x.odemeId, x.kanal, x.matrah, x.kdv, x.kdvHesaplandi])).toEqual([
      [kartliId, "eposta", "2997.00", "599.40", false],
      [elleId, "elle", "1000.00", "200.00", true],
    ]);
    expect(r.kayitlar[1].kaydeden).toBe(kaydeden);
    expect(r.ozet).toMatchObject({ adet: 2, toplam: "4796.40", matrah: "3997.00", kdv: "799.40", hesaplananVar: true });
    expect(r.onceki).toMatchObject({ baslangic: "2025-12-01", bitis: "2025-12-31" });
    expect(JSON.stringify(r)).not.toMatch(/GIZLI|203\.0\.113/);
  });

  it("24 aydan uzun aralığı veritabanı işlevi de reddeder", async () => {
    await expect(platform.$queryRaw`SELECT * FROM platform_odeme_raporu('2023-01-01'::timestamp, '2026-01-01'::timestamp)`).rejects.toThrow(/aralik_cok_uzun/);
  });

  it("sorunlu tahsilatlar: başarısız ve yarım deneme, başarısız kart; gizli alan dönmez", async () => {
    const r = await servis.sorunlu("2026-01-01", "2026-01-31");
    const benim = r.denemeler.filter((x) => x.tenantId === tenantId);
    expect(benim.map((x) => [x.durum, x.kanal, x.toplam])).toEqual([["sonuclanmadi", "panel", "1198.80"], ["basarisiz", "otomatik", "1198.80"]]);
    expect(r.kartlar.find((x) => x.tenantId === tenantId)).toMatchObject({ son4: "0006", kartMarkasi: "MASTER_CARD", denemeSayisi: 2, sonHata: "Yetersiz bakiye" });
    expect(JSON.stringify(r)).not.toMatch(/GIZLI|203\.0\.113/);
  });

  it("yaklaşan yenilemeler: kartın süresiyle beklenen tutar", async () => {
    const r = await servis.yaklasan(30);
    expect(r.kayitlar.find((x) => x.tenantId === tenantId)).toMatchObject({
      planAdi: "Profesyonel",
      kart: { son4: "0006", otomatikYenileme: false, aySayisi: 3 },
      beklenen: { aySayisi: 3, toplam: "3596.40" },
    });
  });
});
