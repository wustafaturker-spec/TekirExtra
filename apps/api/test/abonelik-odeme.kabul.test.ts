import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AbonelikOdemeService } from "../src/abonelik-odeme/abonelik-odeme.service";
import type { AbonelikOdemeSaglayicisi } from "../src/abonelik-odeme/abonelik-saglayici";
import { PrismaService } from "../src/core/prisma.service";

/**
 * PLT-12/13: abonelik ödemesi gerçek PostgreSQL'de, RLS'e tabi uygulama
 * rolüyle. Sağlayıcı sahtedir (iyzico sandbox'ı yerine); dönem uzatma, tek
 * sayım, askı kalkması ve kiracı yalıtımı gerçektir.
 */
const env = resolve(__dirname, "../.env");
if (existsSync(env)) process.loadEnvFile(env);
delete process.env.DATABASE_URL_PLATFORM; // olay kaydı ve sağlayıcı okuması sahtede
process.env.SMTP_PORT = "1"; // makbuz e-postası gitmez; hata kaydı ödemeyi bozmamalı

const yonetici = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const db = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });

const tenantId = randomUUID();
const digerTenantId = randomUUID();
const userId = randomUUID();
const donemSonu = new Date("2026-10-31T21:00:00Z");

let saglayiciSonucu = { basarili: true, odemeId: "PAY-1", tutar: 478.8, dovizCinsi: "TRY" };
const sahte: AbonelikOdemeSaglayicisi = {
  odemeBaslat: vi.fn(async (g) => ({ token: `tok-${g.denemeId}`, odemeSayfasiUrl: `https://sandbox.ornek.invalid/${g.denemeId}` })),
  odemeSonucu: vi.fn(async () => saglayiciSonucu),
};
const servis = new AbonelikOdemeService(
  db,
  { etkin: async () => ({ saglayici: "iyzico", ortam: "test", config: {} }) } as any,
  { db: {} } as any,
  { unut: vi.fn() } as any,
);
servis.saglayiciUret = () => sahte;

beforeAll(async () => {
  for (const [id, ad] of [[tenantId, "ABONELİK ÖDEME KABUL"], [digerTenantId, "ABONELİK ÖDEME DİĞER"]] as const)
    await yonetici.$executeRaw`INSERT INTO tenants (id, unvan, vkn, vergi_dairesi, il, created_at, updated_at) VALUES (${id}::uuid, ${ad}, ${String(parseInt(id.slice(0, 8), 16)).padStart(10, '0').slice(-10)}, 'Test', 'Ankara', now(), now())`;
  await yonetici.$executeRaw`INSERT INTO tenant_abonelikleri (id, tenant_id, plan_kodu, durum, aski_nedeni, donem_sonu, created_at, updated_at) VALUES (gen_random_uuid(), ${tenantId}::uuid, 'baslangic', 'askida', 'odeme', ${donemSonu}, now(), now())`;
  await yonetici.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, aktif, created_at, updated_at) VALUES (${userId}::uuid, ${tenantId}::uuid, ${`odeme-kabul-${tenantId}@ornek.invalid`}, 'x', 'Kabul Kişi', 'yonetici', true, now(), now())`;
});

afterAll(async () => {
  await yonetici.$executeRaw`DELETE FROM users WHERE tenant_id = ${tenantId}::uuid`;
  await yonetici.$executeRaw`DELETE FROM tenants WHERE id IN (${tenantId}::uuid, ${digerTenantId}::uuid)`;
  await Promise.all([yonetici.$disconnect(), db.$disconnect()]);
});

describe("abonelik ödemesi (PLT-12/13) — gerçek PostgreSQL", () => {
  let denemeId = "";

  it("panelden başlatılan girişim KDV dahil tutarla açılır ve sağlayıcı sayfası döner", async () => {
    const s = await servis.baslat(tenantId, 1, "panel", userId, "203.0.113.9");
    denemeId = s.denemeId;
    expect(s.odemeSayfasiUrl).toBe(`https://sandbox.ornek.invalid/${denemeId}`);
    const [d] = await yonetici.$queryRaw<{ matrah: string; kdv: string; toplam: string; durum: string; saglayici_token: string }[]>`
      SELECT matrah::text, kdv::text, toplam::text, durum, saglayici_token FROM abonelik_odeme_denemeleri WHERE id = ${denemeId}::uuid`;
    expect(d).toEqual({ matrah: "399.00", kdv: "79.80", toplam: "478.80", durum: "baslatildi", saglayici_token: `tok-${denemeId}` });
    const girdi = vi.mocked(sahte.odemeBaslat).mock.calls[0][0];
    expect(girdi.callbackUrl).toMatch(new RegExp(`/api/v1/abonelik-odeme/iyzico/callback/${tenantId}/${denemeId}$`));
    expect(girdi.alici).toMatchObject({ ad: "Kabul", soyad: "Kişi", il: "Ankara", ip: "203.0.113.9" });
  });

  it("token uyuşmazsa ödeme sayılmaz", async () => {
    await expect(servis.callback(tenantId, denemeId, "baska-token")).rejects.toMatchObject({ status: 400 });
    await expect(servis.callback(digerTenantId, denemeId, `tok-${denemeId}`)).rejects.toMatchObject({ status: 400 }); // RLS: başka firmada girişim görünmez
  });

  it("başarılı ödeme dönemi eski dönem sonundan uzatır, ödeme nedeniyle askıyı kaldırır ve tek kez sayılır", async () => {
    const ilk = await servis.callback(tenantId, denemeId, `tok-${denemeId}`);
    expect(ilk).toMatchObject({ tekrar: false, askiKalkti: true });
    const tekrar = await servis.callback(tenantId, denemeId, `tok-${denemeId}`);
    expect(tekrar.tekrar).toBe(true);

    const [a] = await yonetici.$queryRaw<{ durum: string; aski_nedeni: string | null; donem_sonu: Date }[]>`
      SELECT durum::text, aski_nedeni, donem_sonu FROM tenant_abonelikleri WHERE tenant_id = ${tenantId}::uuid`;
    expect(a.durum).toBe("aktif");
    expect(a.aski_nedeni).toBeNull();
    expect(a.donem_sonu.toISOString()).toBe("2026-11-30T21:00:00.000Z");

    const odemeler = await yonetici.$queryRaw<{ kaynak: string; saglayici: string; tutar: string; kdv: string; platform_kullanici_id: string | null }[]>`
      SELECT kaynak, saglayici, tutar::text, kdv::text, platform_kullanici_id FROM abonelik_odemeleri WHERE tenant_id = ${tenantId}::uuid`;
    expect(odemeler).toEqual([{ kaynak: "saglayici", saglayici: "iyzico", tutar: "478.80", kdv: "79.80", platform_kullanici_id: null }]);
    const [g] = await yonetici.$queryRaw<{ neden: string }[]>`SELECT neden FROM abonelik_degisiklikleri WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at DESC LIMIT 1`;
    expect(g.neden).toMatch(/^Ödeme alındı \(iyzico\): 1 ay, 478,80 TL \(KDV dahil\); dönem sonu 0?1\.12\.2026; ödeme nedeniyle askı kalktı$/);
  });

  it("sağlayıcının bildirdiği tutar girişimle uyuşmazsa girişim başarısız olur, dönem değişmez", async () => {
    const s = await servis.baslat(tenantId, 3, "eposta", null);
    saglayiciSonucu = { basarili: true, odemeId: "PAY-2", tutar: 1, dovizCinsi: "TRY" };
    await expect(servis.callback(tenantId, s.denemeId, `tok-${s.denemeId}`)).rejects.toMatchObject({ status: 400 });
    const [d] = await yonetici.$queryRaw<{ durum: string; kaynak: string; hata_mesaji: string }[]>`SELECT durum, kaynak, hata_mesaji FROM abonelik_odeme_denemeleri WHERE id = ${s.denemeId}::uuid`;
    expect(d).toMatchObject({ durum: "basarisiz", kaynak: "eposta" });
    const [a] = await yonetici.$queryRaw<{ donem_sonu: Date }[]>`SELECT donem_sonu FROM tenant_abonelikleri WHERE tenant_id = ${tenantId}::uuid`;
    expect(a.donem_sonu.toISOString()).toBe("2026-11-30T21:00:00.000Z");
  });

  it("başka nedenle askıdaki firma ödemeyle açılmaz", async () => {
    await yonetici.$executeRaw`UPDATE tenant_abonelikleri SET durum = 'askida', aski_nedeni = 'diger' WHERE tenant_id = ${tenantId}::uuid`;
    const s = await servis.baslat(tenantId, 1, "panel", userId);
    saglayiciSonucu = { basarili: true, odemeId: "PAY-3", tutar: 478.8, dovizCinsi: "TRY" };
    expect(await servis.callback(tenantId, s.denemeId, `tok-${s.denemeId}`)).toMatchObject({ tekrar: false, askiKalkti: false });
    const [a] = await yonetici.$queryRaw<{ durum: string; aski_nedeni: string }[]>`SELECT durum::text, aski_nedeni FROM tenant_abonelikleri WHERE tenant_id = ${tenantId}::uuid`;
    expect(a).toEqual({ durum: "askida", aski_nedeni: "diger" });
  });

  it("uygulama rolü sağlayıcı anahtarlarını okuyamaz", async () => {
    await expect(db.$queryRaw`SELECT count(*) FROM abonelik_saglayici_ayarlari`).rejects.toThrow(/permission denied/);
  });
});
