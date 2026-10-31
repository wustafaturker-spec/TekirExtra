import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { PlatformFirmaService } from "../src/mevzuat/platform-firma.service";
import type { PlatformPrismaService } from "../src/mevzuat/platform-prisma.service";

/**
 * PLT-27: elle ödeme gerçek PostgreSQL'de, platform rolüyle. Ödeme, dönem
 * uzatma ve olay kaydı tek transaction'dadır; aynı işlem anahtarı tek mali etki
 * üretir. Kalıcı yazılan ödemeler 0 TL'dir: aynı veritabanındaki pilot worker
 * tutarı sıfırdan büyük faturasız ödemeleri gerçek fatura taslağına çevirir.
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
const erisim = { unut: () => undefined };
const servis = (db: unknown = platform) => new PlatformFirmaService({ db } as unknown as PlatformPrismaService, erisim as never, undefined as never);

/** Olay kaydı yazılamayan bağlantı: işlem ilerler, olay adımında hata verir. */
const olaySiz = new Proxy(platform, {
  get(hedef, ad) {
    if (ad !== "$transaction") return Reflect.get(hedef, ad);
    return (fn: (tx: unknown) => Promise<unknown>) => hedef.$transaction((tx) => fn(new Proxy(tx, {
      get: (t, a) => (a === "mevzuatOlay" ? { create: async () => { throw new Error("olay_yazilamadi"); } } : Reflect.get(t, a)),
    })));
  },
});

const tenantId = randomUUID();
const ekipId = randomUUID();
const anahtar = () => randomBytes(18).toString("base64url");
const olarak = <T>(is: () => Promise<T>, kullaniciId = ekipId) => platformBaglamiylaCalistir({ kullaniciId, eposta: "ekip@kabul.invalid", rol: "yonetici" }, is);
const odemeler = (a: string) => yonetici.abonelikOdemesi.findMany({ where: { islemAnahtari: a } });
const donemSonu = async () => (await yonetici.$queryRaw<{ d: Date | null }[]>`SELECT donem_sonu AS d FROM tenant_abonelikleri WHERE tenant_id = ${tenantId}::uuid`)[0]?.d ?? null;

beforeAll(async () => {
  await yonetici.$executeRaw`INSERT INTO tenants (id, unvan, vkn, vergi_dairesi, created_at, updated_at) VALUES (${tenantId}::uuid, 'PLT-27 KABUL FİRMASI', ${String(Date.now()).slice(-10)}, 'Test', now(), now())`;
  await yonetici.$executeRaw`INSERT INTO tenant_abonelikleri (id, tenant_id, plan_kodu, durum, donem_sonu, created_at, updated_at) VALUES (gen_random_uuid(), ${tenantId}::uuid, 'baslangic', 'aktif', now(), now(), now())`;
});

afterAll(async () => {
  await yonetici.$executeRaw`DELETE FROM mevzuat_olaylari WHERE kullanici_id = ${ekipId}::uuid`;
  await yonetici.$executeRaw`DELETE FROM tenants WHERE id = ${tenantId}::uuid`;
  await Promise.all([yonetici.$disconnect(), platform.$disconnect()]);
});

describe("PLT-27 — elle ödemede atomiklik ve tekrar koruması (gerçek PostgreSQL)", () => {
  it("yanıt kaybından sonra aynı istek tek ödeme ve tek dönem uzatması üretir; olay bir kez yazılır", async () => {
    const a = anahtar();
    const once = await donemSonu();
    const ilk = await olarak(() => servis().odemeKaydet(tenantId, 1, "0", "Havale", a));
    const ikinci = await olarak(() => servis().odemeKaydet(tenantId, 1, "0", "Havale", a));
    expect(ilk.tekrar).toBe(false);
    expect(ikinci).toMatchObject({ tekrar: true, odemeId: ilk.odemeId, yeniDonemSonu: ilk.yeniDonemSonu });
    expect(await odemeler(a)).toHaveLength(1);
    expect((await donemSonu())!.getTime()).toBe(ilk.yeniDonemSonu.getTime());
    expect((await donemSonu())!.getTime()).toBeGreaterThan(once!.getTime());
    const olay = await yonetici.mevzuatOlay.findMany({ where: { kullaniciId: ekipId, olay: "abonelik_odemesi_alindi" } });
    expect(olay.filter((o) => (o.detay as { islemAnahtari?: string }).islemAnahtari === a)).toHaveLength(1);
  });

  it("aynı anahtar farklı içerikle (tutar, süre, not, başka kişi) 409 alır ve hiçbir şey değişmez", async () => {
    const a = anahtar();
    await olarak(() => servis().odemeKaydet(tenantId, 3, "0", null, a));
    const sonra = await donemSonu();
    for (const [ay, not, kisi] of [[3, "farklı not", ekipId], [1, null, ekipId], [3, null, randomUUID()]] as const) {
      await expect(olarak(() => servis().odemeKaydet(tenantId, ay, "0", not, a), kisi)).rejects.toMatchObject({ status: 409 });
    }
    expect(await odemeler(a)).toHaveLength(1);
    expect((await donemSonu())!.getTime()).toBe(sonra!.getTime());
  });

  it("aynı anahtarla eşzamanlı 6 istek tek mali etki yaratır", async () => {
    const a = anahtar();
    const once = await donemSonu();
    const sonuc = await Promise.all(Array.from({ length: 6 }, () => olarak(() => servis().odemeKaydet(tenantId, 1, "0", null, a))));
    expect(sonuc.filter((s) => !s.tekrar)).toHaveLength(1);
    expect(new Set(sonuc.map((s) => s.odemeId)).size).toBe(1);
    expect(await odemeler(a)).toHaveLength(1);
    const ay = (await donemSonu())!.getTime() - once!.getTime();
    expect(ay).toBeGreaterThan(27 * 86_400_000);
    expect(ay).toBeLessThan(32 * 86_400_000);
  });

  it("olay kaydı yazılamazsa ödeme ve dönem değişmez; aynı anahtarla yeniden deneme sonra çalışır", async () => {
    const a = anahtar();
    const once = await donemSonu();
    await expect(olarak(() => servis(olaySiz).odemeKaydet(tenantId, 6, "0", null, a))).rejects.toThrow(/olay_yazilamadi/);
    expect(await odemeler(a)).toHaveLength(0);
    expect((await donemSonu())!.getTime()).toBe(once!.getTime());
    const s = await olarak(() => servis().odemeKaydet(tenantId, 6, "0", null, a));
    expect(s.tekrar).toBe(false);
    expect(await odemeler(a)).toHaveLength(1);
  });

  it("olay kaydı yazılamazsa askıya alma da geri alınır", async () => {
    await expect(olarak(() => servis(olaySiz).durumDegistir(tenantId, "askida", "Kabul testi"))).rejects.toThrow(/olay_yazilamadi/);
    const [a] = await yonetici.$queryRaw<{ durum: string }[]>`SELECT durum::text FROM tenant_abonelikleri WHERE tenant_id = ${tenantId}::uuid`;
    expect(a.durum).toBe("aktif");
  });

  it("tutar kuruş hassasiyetinde saklanır (geri alınan transaction içinde; worker görmez)", async () => {
    const a = anahtar();
    const geriAl = new Error("geri_al");
    await expect(platform.$transaction(async (tx) => {
      const [k] = await tx.$queryRaw<{ odeme_id: string }[]>`SELECT * FROM platform_odeme_kaydet(${tenantId}::uuid, 1, ${"1500.10"}::numeric, NULL, ${ekipId}::uuid, 'ekip@kabul.invalid', ${a}, 'ozet')`;
      // Platform rolü ödeme tablosunu doğrudan okuyamaz; kendi geçmiş işleviyle okur.
      const [g] = await tx.$queryRaw<{ g: { odemeler: { id: string; tutar: number }[] } }[]>`SELECT platform_firma_abonelik_gecmisi(${tenantId}::uuid) AS g`;
      expect(g.g.odemeler.find((o) => o.id === k.odeme_id)?.tutar).toBe(1500.1);
      const [t] = await tx.$queryRaw<{ neden: string }[]>`SELECT (platform_firma_abonelik_gecmisi(${tenantId}::uuid)->'degisiklikler'->0->>'neden') AS neden`;
      expect(t.neden).toMatch(/1.?500,10 TL/);
      throw geriAl;
    })).rejects.toBe(geriAl);
    expect(await odemeler(a)).toHaveLength(0);
    // Kuruştan küçük tutar hiçbir şey yazılmadan reddedilir.
    const b = anahtar();
    await expect(platform.$queryRaw`SELECT * FROM platform_odeme_kaydet(${tenantId}::uuid, 1, ${"1.005"}::numeric, NULL, ${ekipId}::uuid, 'x', ${b}, 'ozet')`).rejects.toThrow(/gecersiz_tutar/);
    expect(await odemeler(b)).toHaveLength(0);
  });

  it("anahtarsız çağrı reddedilir; uygulama rolü yeni işlevi çağıramaz", async () => {
    await expect(platform.$queryRaw`SELECT * FROM platform_odeme_kaydet(${tenantId}::uuid, 1, 0, NULL, ${ekipId}::uuid, 'x', NULL, 'ozet')`).rejects.toThrow(/islem_anahtari_yok/);
    const uygulama = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    await expect(uygulama.$queryRaw`SELECT * FROM platform_odeme_kaydet(${tenantId}::uuid, 1, 0, NULL, ${ekipId}::uuid, 'x', ${anahtar()}, 'ozet')`).rejects.toThrow(/permission denied/);
    await uygulama.$disconnect();
  });
});
