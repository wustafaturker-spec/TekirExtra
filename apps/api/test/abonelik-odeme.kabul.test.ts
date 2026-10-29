import { createHmac, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AbonelikOdemeService } from "../src/abonelik-odeme/abonelik-odeme.service";
import { PaytrAbonelikSaglayicisi, type AbonelikOdemeSaglayicisi, type KayitliOdemeSonucu, type OdemeSonucu } from "../src/abonelik-odeme/abonelik-saglayici";
import { merchantOid } from "../src/abonelik-odeme/paytr-direkt";
import { coz } from "../src/core/kripto";
import { PrismaService } from "../src/core/prisma.service";

/**
 * PLT-12/13/14: abonelik ödemesi gerçek PostgreSQL'de, RLS'e tabi uygulama
 * rolüyle. iyzico sahtedir (sandbox yerine); PayTR bildirimi gerçek imzayla
 * doğrulanır. Dönem uzatma, tek sayım, askı kalkması, kart kaydı, otomatik
 * yenileme sayaçları ve kiracı yalıtımı gerçektir.
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

process.env.BAGLANTI_SIFRELEME_ANAHTARI ??= "b".repeat(64);
let saglayiciSonucu: OdemeSonucu = { basarili: true, odemeId: "PAY-1", tutar: 478.8, dovizCinsi: "TRY" };
let kayitliSonuc: KayitliOdemeSonucu = { durum: "odendi", odemeId: "OTO-1" };
const sahte: AbonelikOdemeSaglayicisi = {
  odemeBaslat: vi.fn(async (g) => ({ token: `tok-${g.denemeId}`, odemeSayfasiUrl: `https://sandbox.ornek.invalid/${g.denemeId}` })),
  odemeSonucu: vi.fn(async () => saglayiciSonucu),
  kayitliKartlaOde: vi.fn(async () => kayitliSonuc),
  kartSil: vi.fn(async () => undefined),
};
let etkinAyar: any = { saglayici: "iyzico", ortam: "test", config: {} };
const servis = new AbonelikOdemeService(db, { etkin: async () => etkinAyar } as any, { db: {} } as any, { unut: vi.fn() } as any);
servis.saglayiciUret = (ayar) => (ayar.saglayici === "paytr" ? new PaytrAbonelikSaglayicisi(ayar) : sahte);
const yeniKiraci = randomUUID();
const paytrKiraci = randomUUID();

beforeAll(async () => {
  for (const [id, ad] of [[tenantId, "ABONELİK ÖDEME KABUL"], [digerTenantId, "ABONELİK ÖDEME DİĞER"], [yeniKiraci, "ABONELİK YENİLEME KABUL"], [paytrKiraci, "ABONELİK PAYTR KABUL"]] as const)
    await yonetici.$executeRaw`INSERT INTO tenants (id, unvan, vkn, vergi_dairesi, il, created_at, updated_at) VALUES (${id}::uuid, ${ad}, ${String(parseInt(id.slice(0, 8), 16)).padStart(10, '0').slice(-10)}, 'Test', 'Ankara', now(), now())`;
  await yonetici.$executeRaw`INSERT INTO tenant_abonelikleri (id, tenant_id, plan_kodu, durum, aski_nedeni, donem_sonu, created_at, updated_at) VALUES (gen_random_uuid(), ${tenantId}::uuid, 'baslangic', 'askida', 'odeme', ${donemSonu}, now(), now())`;
  for (const t of [tenantId, yeniKiraci, paytrKiraci])
    await yonetici.$executeRaw`INSERT INTO users (id, tenant_id, eposta, parola_hash, ad_soyad, rol, aktif, created_at, updated_at) VALUES (${t === tenantId ? userId : randomUUID()}::uuid, ${t}::uuid, ${`odeme-kabul-${t}@ornek.invalid`}, 'x', 'Kabul Kişi', 'yonetici', true, now(), now())`;
  // Dönemi 2 gün sonra biten firmalar (otomatik yenileme penceresinde).
  for (const t of [yeniKiraci, paytrKiraci])
    await yonetici.$executeRaw`INSERT INTO tenant_abonelikleri (id, tenant_id, plan_kodu, durum, donem_sonu, created_at, updated_at) VALUES (gen_random_uuid(), ${t}::uuid, 'baslangic', 'aktif', now() + interval '2 days', now(), now())`;
});

afterAll(async () => {
  await yonetici.$executeRaw`DELETE FROM users WHERE tenant_id IN (${tenantId}::uuid, ${yeniKiraci}::uuid, ${paytrKiraci}::uuid)`;
  await yonetici.$executeRaw`DELETE FROM tenants WHERE id IN (${tenantId}::uuid, ${digerTenantId}::uuid, ${yeniKiraci}::uuid, ${paytrKiraci}::uuid)`;
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
    expect(girdi).toMatchObject({ tenantId, denemeId, toplam: "478.80", kartKaydet: false });
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

describe("otomatik yenileme (PLT-14) — gerçek PostgreSQL", () => {
  const donem = async (t: string) => (await yonetici.$queryRaw<{ donem_sonu: Date }[]>`SELECT donem_sonu FROM tenant_abonelikleri WHERE tenant_id = ${t}::uuid`)[0].donem_sonu;
  const kart = async (t: string) => (await yonetici.$queryRaw<{ sifreli_anahtarlar: string; son4: string; deneme_sayisi: number; son_hata: string | null; otomatik_yenileme: boolean; ay_sayisi: number }[]>`
    SELECT sifreli_anahtarlar, son4, deneme_sayisi, son_hata, otomatik_yenileme, ay_sayisi FROM abonelik_kartlari WHERE tenant_id = ${t}::uuid`)[0];

  it("kart kaydıyla ödeme kartı şifreli saklar ve otomatik yenilemeyi açar", async () => {
    etkinAyar = { saglayici: "iyzico", ortam: "test", config: {} };
    const s = await servis.baslat(yeniKiraci, 1, "panel", null, "198.51.100.4", true);
    saglayiciSonucu = { basarili: true, odemeId: "PAY-K", tutar: 478.8, dovizCinsi: "TRY", kart: { anahtarlar: { cardUserKey: "CUK", cardToken: "CT" }, son4: "4242", marka: "VISA" } };
    expect(await servis.callback(yeniKiraci, s.denemeId, `tok-${s.denemeId}`)).toMatchObject({ kartKaydedildi: true });
    const k = await kart(yeniKiraci);
    expect(k).toMatchObject({ son4: "4242", otomatik_yenileme: true, ay_sayisi: 1, deneme_sayisi: 0 });
    expect(k.sifreli_anahtarlar).not.toContain("CUK");
    expect(JSON.parse(coz(k.sifreli_anahtarlar))).toEqual({ cardUserKey: "CUK", cardToken: "CT" });
    // Ödeme dönemi 1 ay uzattı; yenileme penceresine geri sokalım.
    await yonetici.$executeRaw`UPDATE tenant_abonelikleri SET donem_sonu = now() + interval '2 days' WHERE tenant_id = ${yeniKiraci}::uuid`;
  });

  it("başarısız çekim sayılır, aynı gün yeniden denenmez; üçüncü denemeden sonra durur", async () => {
    kayitliSonuc = { durum: "basarisiz", hata: "Yetersiz bakiye" };
    expect(await servis.otomatikYenile(yeniKiraci)).toBe("basarisiz");
    expect(await kart(yeniKiraci)).toMatchObject({ deneme_sayisi: 1, son_hata: "Yetersiz bakiye" });
    expect(await servis.otomatikYenile(yeniKiraci)).toBe("atlandi"); // 23 saat dolmadı
    for (const beklenen of [2, 3]) {
      await yonetici.$executeRaw`UPDATE abonelik_kartlari SET son_deneme_at = now() - interval '1 day' WHERE tenant_id = ${yeniKiraci}::uuid`;
      expect(await servis.otomatikYenile(yeniKiraci)).toBe("basarisiz");
      expect((await kart(yeniKiraci)).deneme_sayisi).toBe(beklenen);
    }
    await yonetici.$executeRaw`UPDATE abonelik_kartlari SET son_deneme_at = now() - interval '1 day' WHERE tenant_id = ${yeniKiraci}::uuid`;
    expect(await servis.otomatikYenile(yeniKiraci)).toBe("atlandi"); // dönem başına 3
    expect(vi.mocked(sahte.kayitliKartlaOde)).toHaveBeenCalledTimes(3);
  });

  it("yeni dönemde sayaç sıfırlanır; başarılı çekim dönemi uzatır ve hatayı temizler", async () => {
    const once = await yonetici.$queryRaw<{ donem_sonu: Date }[]>`UPDATE tenant_abonelikleri SET donem_sonu = now() + interval '1 day' WHERE tenant_id = ${yeniKiraci}::uuid RETURNING donem_sonu`;
    kayitliSonuc = { durum: "odendi", odemeId: "OTO-1" };
    expect(await servis.otomatikYenile(yeniKiraci)).toBe("odendi");
    const sonra = await donem(yeniKiraci);
    expect(sonra.getTime()).toBeGreaterThan(once[0].donem_sonu.getTime() + 27 * 86_400_000);
    expect((await kart(yeniKiraci)).son_hata).toBeNull();
    const [o] = await yonetici.$queryRaw<{ not: string }[]>`SELECT "not" FROM abonelik_odemeleri WHERE tenant_id = ${yeniKiraci}::uuid ORDER BY created_at DESC LIMIT 1`;
    expect(o.not).toContain("otomatik yenileme");
  });

  it("askıdaki ya da otomatik yenilemesi kapalı firmada çekim yapılmaz", async () => {
    await yonetici.$executeRaw`UPDATE tenant_abonelikleri SET donem_sonu = now() + interval '1 day', durum = 'askida' WHERE tenant_id = ${yeniKiraci}::uuid`;
    expect(await servis.otomatikYenile(yeniKiraci)).toBe("atlandi");
    await yonetici.$executeRaw`UPDATE tenant_abonelikleri SET durum = 'aktif' WHERE tenant_id = ${yeniKiraci}::uuid`;
    await servis.otomatikYenilemeAyarla(yeniKiraci, false);
    expect(await servis.otomatikYenile(yeniKiraci)).toBe("atlandi");
  });

  it("kart kaldırılınca sağlayıcıdan silinir ve satır gider", async () => {
    await servis.kartKaldir(yeniKiraci);
    expect(vi.mocked(sahte.kartSil)).toHaveBeenCalledWith({ cardUserKey: "CUK", cardToken: "CT" });
    expect(await kart(yeniKiraci)).toBeUndefined();
  });
});

describe("PayTR bildirimi (PLT-13/14) — gerçek imza, gerçek PostgreSQL", () => {
  const config = { magazaId: "999", merchantKey: "mk", merchantSalt: "ms" };
  const imza = (oid: string, status: string, tutar: string) => createHmac("sha256", "mk").update(`${oid}ms${status}${tutar}`).digest("base64");

  it("kart formu IP'yle imzalanır; imzalı başarılı bildirim ödemeyi bir kez kaydeder ve kartı saklar", async () => {
    etkinAyar = { saglayici: "paytr", ortam: "test", config };
    const s = await servis.baslat(paytrKiraci, 1, "panel", null, undefined, true);
    const token = new URL(s.odemeSayfasiUrl).searchParams.get("t")!;
    expect(s.odemeSayfasiUrl).toContain(`/api/v1/abonelik-odeme/paytr/form/${paytrKiraci}/${s.denemeId}?t=`);
    const f = await servis.paytrForm(paytrKiraci, s.denemeId, token, "203.0.113.7");
    expect(f.alanlar).toMatchObject({ merchant_id: "999", user_ip: "203.0.113.7", payment_amount: "478.80", store_card: "1", merchant_oid: merchantOid(paytrKiraci, s.denemeId) });
    await expect(servis.paytrForm(paytrKiraci, s.denemeId, "yanlis", "203.0.113.7")).rejects.toMatchObject({ status: 400 });

    const oid = merchantOid(paytrKiraci, s.denemeId);
    await expect(servis.paytrBildirim({ merchant_oid: oid, status: "success", total_amount: "47880", hash: "sahte" })).rejects.toMatchObject({ status: 400 });
    const kartIste = vi.spyOn(PaytrAbonelikSaglayicisi.prototype, "kaydedilenKart").mockResolvedValue({ anahtarlar: { utoken: "UT", ctoken: "CT" }, son4: "1111", marka: "MASTERCARD" });
    const bildirim = { merchant_oid: oid, status: "success", total_amount: "47880", hash: imza(oid, "success", "47880"), utoken: "UT" };
    await servis.paytrBildirim(bildirim);
    await servis.paytrBildirim(bildirim); // PayTR tekrar gönderir
    expect(kartIste).toHaveBeenCalledWith("UT");
    const odemeler = await yonetici.$queryRaw<{ tutar: string; saglayici: string }[]>`SELECT tutar::text, saglayici FROM abonelik_odemeleri WHERE tenant_id = ${paytrKiraci}::uuid`;
    expect(odemeler).toEqual([{ tutar: "478.80", saglayici: "paytr" }]);
    const [k] = await yonetici.$queryRaw<{ saglayici: string; son4: string; odeyen_ip: string; sifreli_anahtarlar: string }[]>`SELECT saglayici, son4, odeyen_ip, sifreli_anahtarlar FROM abonelik_kartlari WHERE tenant_id = ${paytrKiraci}::uuid`;
    expect(k).toMatchObject({ saglayici: "paytr", son4: "1111", odeyen_ip: "203.0.113.7" });
    expect(JSON.parse(coz(k.sifreli_anahtarlar))).toEqual({ utoken: "UT", ctoken: "CT" });
    expect(await servis.paytrSonuc(paytrKiraci, s.denemeId, token)).toMatchObject({ durum: "odendi" });
    kartIste.mockRestore();
  });

  it("imzalı başarısız bildirim girişimi kapatır; tutarı uyuşmayan başarılı bildirim ödeme saymaz", async () => {
    const a = await servis.baslat(paytrKiraci, 1, "eposta", null);
    const oidA = merchantOid(paytrKiraci, a.denemeId);
    await servis.paytrBildirim({ merchant_oid: oidA, status: "failed", total_amount: "0", hash: imza(oidA, "failed", "0"), failed_reason_msg: "Kart limiti yetersiz" });
    expect(await servis.paytrSonuc(paytrKiraci, a.denemeId, new URL(a.odemeSayfasiUrl).searchParams.get("t")!)).toMatchObject({ durum: "basarisiz", hata: expect.stringContaining("Kart limiti yetersiz") });
    const b = await servis.baslat(paytrKiraci, 1, "eposta", null);
    const oidB = merchantOid(paytrKiraci, b.denemeId);
    await servis.paytrBildirim({ merchant_oid: oidB, status: "success", total_amount: "100", hash: imza(oidB, "success", "100") });
    const [d] = await yonetici.$queryRaw<{ durum: string }[]>`SELECT durum FROM abonelik_odeme_denemeleri WHERE id = ${b.denemeId}::uuid`;
    expect(d.durum).toBe("basarisiz");
    expect((await yonetici.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM abonelik_odemeleri WHERE tenant_id = ${paytrKiraci}::uuid`)[0].n).toBe(1n);
  });
});
