import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { Logger } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import type { PlatformPrismaService } from "../src/mevzuat/platform-prisma.service";
import { PlatformAbonelikIadeService } from "../src/abonelik-odeme/platform-abonelik-iade.service";

/**
 * PLT-42…46: abonelik iadesi gerçek PostgreSQL'de, platform rolüyle. Ödemeler
 * 2026-01'e tarihlidir (faturalama başlangıcından önce; pilot worker faturalamaz).
 * Sağlayıcı sahtedir; iade satırının faturalayan tarafı bu testte işlenmez.
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
const ekipId = randomUUID();
const tenantId = randomUUID();
const kartOdemesi = randomUUID();
const elleOdeme = randomUUID();
const anahtar = () => randomBytes(18).toString("base64url");
const fatura = { iadeyiIsle: vi.fn(async () => true) };
const saglayicilar = { etkin: vi.fn(async () => ({ saglayici: "iyzico", ortam: "test", config: { apiKey: "a", secretKey: "s" } })) };
const servis = new PlatformAbonelikIadeService({ db: platform } as unknown as PlatformPrismaService, saglayicilar as never, fatura as never);
const iyzicoIade = vi.fn(async () => ({ ref: "HOST-REF-1", tutar: "100.00" }));
servis.iyzico = { odemeAyrintisi: vi.fn(async () => ({ odemeIslemNolari: ["PTX-1"] })), iadeEt: iyzicoIade } as never;
const olarak = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: ekipId, eposta: "ekip@kabul.invalid", rol: "yonetici" }, is);
const donemSonu = async () => (await yonetici.$queryRaw<{ d: Date }[]>`SELECT donem_sonu AS d FROM tenant_abonelikleri WHERE tenant_id = ${tenantId}::uuid`)[0].d;

beforeAll(async () => {
  await yonetici.platformKullanici.create({ data: { id: ekipId, eposta: `${ekipId}@kabul.invalid`, adSoyad: "İade kabul yetkilisi", parolaHash: "x", totpSecretSifreli: "x", rol: "yonetici" } });
  await yonetici.$executeRaw`INSERT INTO tenants (id, unvan, vkn, vergi_dairesi, created_at, updated_at) VALUES (${tenantId}::uuid, 'PLT-42 KABUL FİRMASI', ${String(Date.now()).slice(-10)}, 'Test', now(), now())`;
  await yonetici.$executeRaw`INSERT INTO tenant_abonelikleri (id, tenant_id, plan_kodu, durum, donem_sonu, created_at, updated_at) VALUES (gen_random_uuid(), ${tenantId}::uuid, 'profesyonel', 'aktif', '2026-07-15 09:00', now(), now())`;
  await yonetici.$executeRaw`INSERT INTO abonelik_odemeleri (id, tenant_id, ay_sayisi, tutar, matrah, kdv, yeni_donem_sonu, kaynak, saglayici, created_at) VALUES (${kartOdemesi}::uuid, ${tenantId}::uuid, 3, 3596.40, 2997.00, 599.40, '2026-07-15 09:00', 'saglayici', 'iyzico', '2026-01-20 09:00')`;
  await yonetici.$executeRaw`INSERT INTO abonelik_odeme_denemeleri (id, tenant_id, saglayici, ortam, kaynak, plan_kodu, ay_sayisi, matrah, kdv, toplam, durum, saglayici_odeme_id, abonelik_odemesi_id, created_at)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, 'iyzico', 'test', 'panel', 'profesyonel', 3, 2997.00, 599.40, 3596.40, 'odendi', 'PAY-KABUL-1', ${kartOdemesi}::uuid, '2026-01-20 08:59')`;
  await yonetici.$executeRaw`INSERT INTO abonelik_odemeleri (id, tenant_id, ay_sayisi, tutar, yeni_donem_sonu, kaynak, platform_kullanici_id, created_at) VALUES (${elleOdeme}::uuid, ${tenantId}::uuid, 1, 1200.00, '2026-04-15 09:00', 'elle', ${ekipId}::uuid, '2026-01-10 09:00')`;
});

afterAll(async () => {
  await yonetici.$executeRaw`DELETE FROM mevzuat_olaylari WHERE kullanici_id = ${ekipId}::uuid`;
  await yonetici.$executeRaw`DELETE FROM tenants WHERE id = ${tenantId}::uuid`;
  await yonetici.platformKullanici.deleteMany({ where: { id: ekipId } });
  await Promise.all([yonetici.$disconnect(), platform.$disconnect()]);
});

describe("PLT-42…46 — abonelik iadesi (gerçek PostgreSQL, platform rolü)", () => {
  it("platform rolü iade tablosunu doğrudan yazamaz; uygulama rolü yalnız durum sütunlarını güncelleyebilir", async () => {
    await expect(platform.$executeRaw`INSERT INTO abonelik_iadeleri (id, tenant_id, odeme_id, tutar, neden, islem_anahtari) VALUES (gen_random_uuid(), ${tenantId}::uuid, ${kartOdemesi}::uuid, 1, 'x', 'y')`).rejects.toThrow(/permission denied/);
    const yetkiler = await yonetici.$queryRaw<{ privilege_type: string }[]>`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee = 'tekir_app' AND table_name = 'abonelik_iadeleri'`;
    expect(yetkiler.map((y) => y.privilege_type)).toContain("SELECT");
    expect(yetkiler.map((y) => y.privilege_type)).not.toContain("INSERT");
    expect(yetkiler.map((y) => y.privilege_type)).not.toContain("DELETE");
  });

  it("kısmi iade sağlayıcıya gider, dönem değişmez; aynı anahtar ikinci iade üretmez", async () => {
    const once = await donemSonu();
    const a = anahtar();
    const r = await olarak(() => servis.iadeEt(kartOdemesi, { tutar: "100.00", neden: "Kısmi indirim", saglayiciyaGonder: true, islemAnahtari: a }));
    expect(r).toMatchObject({ tamIade: false, ref: "HOST-REF-1" });
    expect(iyzicoIade).toHaveBeenCalledWith(expect.anything(), { odemeIslemNo: "PTX-1", tutar: "100.00", dovizCinsi: "TRY", conversationId: a });
    expect(await donemSonu()).toEqual(once);
    const tekrar = await olarak(() => servis.iadeEt(kartOdemesi, { tutar: "100.00", neden: "Kısmi indirim", saglayiciyaGonder: true, islemAnahtari: a }));
    expect(tekrar).toMatchObject({ tekrar: true });
    expect(iyzicoIade).toHaveBeenCalledTimes(1);
    const satirlar = await yonetici.$queryRaw<{ adet: bigint }[]>`SELECT count(*) AS adet FROM abonelik_iadeleri WHERE odeme_id = ${kartOdemesi}::uuid`;
    expect(Number(satirlar[0].adet)).toBe(1);
    expect(fatura.iadeyiIsle).toHaveBeenCalledTimes(1);
  });

  it("kalanı aşan iade reddedilir ve sağlayıcıya gitmez; kilit bırakılır", async () => {
    iyzicoIade.mockClear();
    const uyari = vi.spyOn(Logger.prototype, "warn");
    try {
      await expect(olarak(() => servis.iadeEt(kartOdemesi, { tutar: "3500.00", neden: "Fazla", saglayiciyaGonder: true, islemAnahtari: anahtar() }))).rejects.toThrow(/iade edilebilir kalanı \(3.496,40 TL\)/);
      expect(uyari.mock.calls.some((c) => String(c[0]).includes("subscription_refund_unlock_failed"))).toBe(false);
    } finally { uyari.mockRestore(); }
    expect(iyzicoIade).not.toHaveBeenCalled();
    const [k] = await yonetici.$queryRaw<{ k: Date | null }[]>`SELECT iade_kilidi AS k FROM abonelik_odemeleri WHERE id = ${kartOdemesi}::uuid`;
    expect(k.k).toBeNull();
  });

  it("sürmekte olan iade varken ikinci iade 409 alır", async () => {
    await yonetici.$executeRaw`UPDATE abonelik_odemeleri SET iade_kilidi = now() WHERE id = ${kartOdemesi}::uuid`;
    await expect(olarak(() => servis.iadeEt(kartOdemesi, { tutar: "1.00", neden: "Yarış", saglayiciyaGonder: true, islemAnahtari: anahtar() }))).rejects.toThrow(/sürmekte olan bir iade/);
    await yonetici.$executeRaw`UPDATE abonelik_odemeleri SET iade_kilidi = NULL WHERE id = ${kartOdemesi}::uuid`;
  });

  it("kalanın iadesi tam iadedir: dönem sonu ödemenin süresi (3 ay) kadar geri alınır, geçmişe ve olay kaydına yazılır, ödeme faturalanmaz", async () => {
    const r = await olarak(() => servis.iadeEt(kartOdemesi, { tutar: "3496.40", neden: "Hizmet iptali", saglayiciyaGonder: true, islemAnahtari: anahtar() }));
    expect(r).toMatchObject({ tamIade: true });
    expect((await donemSonu()).toISOString()).toBe(new Date("2026-04-15T09:00:00Z").toISOString());
    const [g] = await yonetici.$queryRaw<{ neden: string }[]>`SELECT neden FROM abonelik_degisiklikleri WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at DESC LIMIT 1`;
    expect(g.neden).toMatch(/Ödeme iade edildi \(ekip@kabul.invalid\): 3496,40 TL \(tam iade\); dönem sonu 15\.07\.2026 → 15\.04\.2026 — Hizmet iptali/);
    const olaylar = await yonetici.$queryRaw<{ adet: bigint }[]>`SELECT count(*) AS adet FROM mevzuat_olaylari WHERE kullanici_id = ${ekipId}::uuid AND olay = 'abonelik_odemesi_iade_edildi'`;
    expect(Number(olaylar[0].adet)).toBe(2);
    const faturasiz = await yonetici.$queryRaw<{ odeme_id: string }[]>`SELECT odeme_id FROM platform_faturasiz_abonelik_odemeleri(true)`;
    expect(faturasiz.map((x) => x.odeme_id)).not.toContain(kartOdemesi);
    const [rapor] = await platform.$queryRaw<{ iade_tutari: unknown }[]>`SELECT iade_tutari FROM platform_odeme_raporu('2026-01-20', '2026-01-21') WHERE odeme_id = ${kartOdemesi}::uuid`;
    expect(Number(rapor.iade_tutari)).toBe(3596.4);
    await expect(olarak(() => servis.iadeEt(kartOdemesi, { tutar: "0.01", neden: "Artık yok", saglayiciyaGonder: false, islemAnahtari: anahtar() }))).rejects.toThrow(/kalanı \(0,00 TL\)/);
  });

  it("elle (havale) ödeme sağlayıcıya gitmeden kaydedilir; firma geçmişinde iade görünür", async () => {
    iyzicoIade.mockClear();
    const r = await olarak(() => servis.iadeEt(elleOdeme, { tutar: "1200.00", neden: "Havale iadesi", saglayiciyaGonder: true, islemAnahtari: anahtar() }));
    expect(r).toMatchObject({ tamIade: true, ref: null });
    expect(r.mesaj).toMatch(/havale iadesini bankadan yapın/);
    expect(iyzicoIade).not.toHaveBeenCalled();
    const [g] = await platform.$queryRaw<{ gecmis: { odemeler: { id: string; iadeler: { tutar: number; saglayiciyaGonderildi: boolean }[] }[] } }[]>`SELECT platform_firma_abonelik_gecmisi(${tenantId}::uuid) AS gecmis`;
    const elle = g.gecmis.odemeler.find((o) => o.id === elleOdeme)!;
    expect(elle.iadeler).toEqual([expect.objectContaining({ tutar: 1200, saglayiciyaGonderildi: false })]);
  });

  it("ödemeyi alan sağlayıcı etkin değilse sağlayıcıya gitmez, açık ileti verir", async () => {
    const yeni = randomUUID();
    await yonetici.$executeRaw`INSERT INTO abonelik_odemeleri (id, tenant_id, ay_sayisi, tutar, matrah, kdv, yeni_donem_sonu, kaynak, saglayici, created_at) VALUES (${yeni}::uuid, ${tenantId}::uuid, 1, 1198.80, 999.00, 199.80, '2026-05-15', 'saglayici', 'paytr', '2026-01-25 09:00')`;
    await expect(olarak(() => servis.iadeEt(yeni, { tutar: "10.00", neden: "Deneme", saglayiciyaGonder: true, islemAnahtari: anahtar() }))).rejects.toThrow(/PayTR.*etkin değil.*sağlayıcıya gönderme/);
    const [k] = await yonetici.$queryRaw<{ k: Date | null }[]>`SELECT iade_kilidi AS k FROM abonelik_odemeleri WHERE id = ${yeni}::uuid`;
    expect(k.k).toBeNull();
  });
});
