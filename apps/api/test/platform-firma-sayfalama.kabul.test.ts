import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlatformFirmaService } from "../src/mevzuat/platform-firma.service";
import { firmaFiltreSemasi } from "../src/mevzuat/platform-firma-filtre";

const env = resolve(__dirname, "../.env");
if (existsSync(env)) process.loadEnvFile(env);
const yonetici = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const platform = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_PLATFORM });
const servis = new PlatformFirmaService({ db: platform } as never, {} as never, {} as never);
const onek = `SAYFALI-${randomUUID()}`;
const ids = Array.from({ length: 215 }, () => randomUUID());
const getir = (ek: Record<string, unknown> = {}) => servis.sayfali(firmaFiltreSemasi.parse({ arama: onek, ...ek }));

beforeAll(async () => {
  await yonetici.$executeRaw(Prisma.sql`INSERT INTO tenants (id, unvan, vkn, vergi_dairesi, created_at, updated_at)
    VALUES ${Prisma.join(ids.map((id, n) => Prisma.sql`(${id}::uuid, ${`${onek} ${String(n).padStart(3, "0")}`}, ${id.replaceAll("-", "").slice(0, 10)}, 'Test', '2026-11-01 22:30:00'::timestamp, now())`))}`);
  await yonetici.$executeRaw(Prisma.sql`INSERT INTO tenant_abonelikleri (id, tenant_id, plan_kodu, durum, donem_sonu, created_at, updated_at)
    VALUES ${Prisma.join(ids.map((id, n) => Prisma.sql`(gen_random_uuid(), ${id}::uuid, ${n % 2 ? "kurumsal" : "baslangic"}, 'aktif', (now() AT TIME ZONE 'UTC') + interval '2 days', now(), now())`))}`);
  await yonetici.baglanti.create({ data: { tenantId: ids[0], aile: "ebelge", saglayici: "kabul-test", sifreliConfig: "test", durum: "hata", otomatikSenkronDk: 0 } });
});
afterAll(async () => {
  await yonetici.baglanti.deleteMany({ where: { tenantId: { in: ids } } });
  await yonetici.$executeRaw(Prisma.sql`DELETE FROM users WHERE tenant_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`);
  await yonetici.$executeRaw(Prisma.sql`DELETE FROM tenants WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`);
  await Promise.all([yonetici.$disconnect(), platform.$disconnect()]);
});

describe("firma sunucu sayfalaması — gerçek PostgreSQL", () => {
  it("200 üzerindeki tüm firmalara yinelenmeden ulaşır, boş sayfada toplamı korur", async () => {
    const kayitlar = [];
    for (let sayfa = 1; sayfa <= 9; sayfa++) {
      const sonuc = await getir({ sayfa });
      expect(sonuc.toplam).toBe(215);
      expect(sonuc.kayitlar.length).toBeLessThanOrEqual(25);
      kayitlar.push(...sonuc.kayitlar);
    }
    expect(new Set(kayitlar.map((r) => r.tenantId)).size).toBe(215);
    expect(kayitlar[214].unvan).toBe(`${onek} 214`);
    expect(await getir({ sayfa: 10 })).toMatchObject({ toplam: 215, kayitlar: [] });
  });
  it("plan, hazır görünüm ve tarih aralığını birlikte uygular; sayaçları kapsamdan ayırır", async () => {
    const sonuc = await getir({ plan: "kurumsal", goster: "hicGirmeyen", kayitBaslangic: "2026-11-02", kayitBitis: "2026-11-02" });
    expect(sonuc.toplam).toBe(107);
    expect(sonuc.sayilar.toplam).toBeGreaterThanOrEqual(215);
    expect(sonuc.kayitlar.every((r) => r.planKodu === "kurumsal" && r.sonGiris === null)).toBe(true);
    expect(await getir({ kayitBitis: "2026-11-01" })).toMatchObject({ toplam: 0, kayitlar: [] });
  });
  it("yenileme ve giriş görünümleri bilinmeyen zamanı etkinlik kabul etmez", async () => {
    expect((await getir({ goster: "yenilenecek" })).toplam).toBe(215);
    expect((await getir({ goster: "denemesiBitecek" })).toplam).toBe(0);
    expect((await getir({ goster: "uzunSuredirGirmeyen" })).toplam).toBe(0);
  });
  it("bağlantı hatası ile e-belge durumunu birlikte süzer", async () => {
    expect((await getir({ baglanti: "hata" })).toplam).toBe(1);
    const hata = await getir({ goster: "baglantiHatali", baglanti: "ebelgeYok" });
    expect(hata.toplam).toBe(1);
    expect(hata.kayitlar[0]).toMatchObject({ tenantId: ids[0], baglantiHatali: true, ebelgeSaglayici: null });
    expect((await getir({ goster: "baglantiHatali", baglanti: "ebelgeAktif" })).toplam).toBe(0);
  });
  it("eşit sıralama değerlerinde tenant kimliğiyle kararlı sıralar", async () => {
    for (const siralama of ["kayitYeni", "sonGiris"] as const) {
      const ilk = await getir({ siralama });
      const ikinci = await getir({ siralama, sayfa: 2 });
      const beklenen = [...ids].sort().slice(0, 50);
      expect([...ilk.kayitlar, ...ikinci.kayitlar].map((r) => r.tenantId)).toEqual(beklenen);
    }
  });
  it("liste sayfası dışında kalan firmayı kimliğiyle getirir ve UTC zamanını korur", async () => {
    const sonuc = await getir({ arama: "", firma: ids[214] });
    expect(sonuc.toplam).toBe(1);
    expect(sonuc.kayitlar[0].tenantId).toBe(ids[214]);
    expect(new Date(sonuc.kayitlar[0].kayitTarihi).toISOString()).toBe("2026-11-01T22:30:00.000Z");
  });
  it("arama jokerlerini ve SQL metnini literal kabul eder", async () => {
    for (const arama of [`${onek}%`, `${onek}_`, `${onek}\\`, "' OR 1=1 --"]) {
      expect(await getir({ arama })).toMatchObject({ toplam: 0, kayitlar: [] });
    }
  });
  it("Türkçe I/İ harflerinde küçük harfli aramayı korur", async () => {
    const unvan = `${onek} IŞIK İNŞAAT`;
    await yonetici.tenant.update({ where: { id: ids[214] }, data: { unvan } });
    try {
      const sonuc = await getir({ arama: `${onek} ışık inşaat` });
      expect(sonuc.toplam).toBe(1);
      expect(sonuc.kayitlar[0].tenantId).toBe(ids[214]);
    } finally {
      await yonetici.tenant.update({ where: { id: ids[214] }, data: { unvan: `${onek} 214` } });
    }
  });
});
