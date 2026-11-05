import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AbonelikOdemeService } from "../src/abonelik-odeme/abonelik-odeme.service";
import { PrismaService } from "../src/core/prisma.service";
const yonetici = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
const db = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });
const tenantId = randomUUID(), userId = randomUUID();
const servis = new AbonelikOdemeService(db, { etkin: async () => ({ saglayici: "iyzico", ortam: "test", config: {} }) } as never, { db: { mevzuatOlay: { create: vi.fn() } } } as never, { unut: vi.fn() } as never);
vi.spyOn(servis as never, "posta").mockResolvedValue(undefined as never);
servis.saglayiciUret = () => ({ odemeBaslat: async (g: {denemeId: string}) => ({ token: g.denemeId, odemeSayfasiUrl: "https://kabul.invalid" }) }) as never;
beforeAll(async () => {
  await yonetici.$executeRaw`INSERT INTO tenants(id,unvan,vkn,vergi_dairesi,il,created_at,updated_at) VALUES (${tenantId}::uuid,'Deneme kabul','1234567890','Test','Ankara',now(),now())`;
  await yonetici.$executeRaw`INSERT INTO users(id,tenant_id,eposta,parola_hash,ad_soyad,rol,aktif,created_at,updated_at) VALUES (${userId}::uuid,${tenantId}::uuid,${tenantId + '@ornek.invalid'},'x','Deneme Kişi','yonetici',true,now(),now())`;
  await yonetici.$executeRaw`INSERT INTO tenant_abonelikleri(id,tenant_id,plan_kodu,durum,created_at,updated_at) VALUES(gen_random_uuid(),${tenantId}::uuid,'baslangic','deneme',now(),now())`;
});
afterAll(async () => {
  await yonetici.$executeRaw`DELETE FROM users WHERE tenant_id = ${tenantId}::uuid`;
  await yonetici.$executeRaw`DELETE FROM tenants WHERE id = ${tenantId}::uuid`;
  await Promise.all([yonetici.$disconnect(),db.$disconnect()]);
});

describe("denemeden ücretli döneme geçiş", () => {
  for (const gun of [-40, 5]) it(`deneme sonu ${gun} gün: kalan süre korunur, geçmiş süre ücretlendirilmez`, async () => {
    const bitis = new Date(Date.now() + gun * 86400000);
    await yonetici.$executeRaw`UPDATE tenant_abonelikleri SET durum = 'deneme', donem_sonu = ${bitis} WHERE tenant_id = ${tenantId}::uuid`;
    const baslangic = new Date();
    const girisim = await servis.baslat(tenantId, 1, "panel", userId);
    await servis.odemeyiKaydet(tenantId, girisim.denemeId, `DENEME-${gun}`);
    const a = await yonetici.tenantAbonelik.findUniqueOrThrow({ where: { tenantId } });
    expect(a.durum).toBe("aktif");
    if (gun > 0) expect(a.donemBaslangici).toEqual(bitis);
    else expect(a.donemBaslangici!.getTime()).toBeGreaterThanOrEqual(baslangic.getTime() - 1000);
    expect(a.donemSonu!.getTime()).toBeGreaterThan(Date.now() + 27 * 86400000);
    expect((await servis.odemeyiKaydet(tenantId, girisim.denemeId, `DENEME-${gun}`)).tekrar).toBe(true);
    expect((await yonetici.tenantAbonelik.findUniqueOrThrow({ where: { tenantId } })).donemSonu).toEqual(a.donemSonu);
  });
  it("manuel ödeme de denemeyi tek kez etkinleştirir", async () => {
    await yonetici.$executeRaw`UPDATE tenant_abonelikleri SET durum = 'deneme', donem_sonu = now() - interval '40 days' WHERE tenant_id = ${tenantId}::uuid`;
    const anahtar = randomUUID();
    const kaydet = () => yonetici.$queryRaw<{tekrar: boolean; yeni_donem_sonu: Date}[]>`SELECT * FROM platform_odeme_kaydet(${tenantId}::uuid, 1, 0, NULL, ${randomUUID()}::uuid, 'test@ornek.invalid', ${anahtar}, 'deneme')`;
    const [ilk] = await kaydet();
    expect(ilk.tekrar).toBe(false);
    expect(ilk.yeni_donem_sonu.getTime()).toBeGreaterThan(Date.now() + 27 * 86400000);
    expect((await kaydet())[0]).toMatchObject({ tekrar: true, yeni_donem_sonu: ilk.yeni_donem_sonu });
    expect((await yonetici.tenantAbonelik.findUniqueOrThrow({ where: { tenantId } })).durum).toBe("aktif");
  });
});
