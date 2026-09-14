import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * EBLG-35: belge durum geçmişi veritabanı tetikleyicisiyle tutulur. Test
 * uygulama rolüyle (RLS altında) ve yönetim rolüyle kurduğu bir kiracıda
 * çalışır; tetikleyicinin yazdığını, yalnız gerçek değişikliği kaydettiğini,
 * geçmişin değiştirilemediğini ve kiracıya göre yalıtıldığını doğrular.
 */

const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const uygulama = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

const tenantId = randomUUID();
const userId = randomUUID();
const faturaId = randomUUID();

/** Uygulamanın PrismaService.tenantIslem'i gibi bağlam kurup çalıştırır. */
function baglamda<T>(kullanici: string, fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>) {
  return uygulama.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${kullanici}, true)`;
    return fn(tx);
  });
}

beforeAll(async () => {
  const cariId = randomUUID();
  await yonetim.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${tenantId}::uuid, 'Durum Geçmişi Test', ${String(Date.now()).slice(-10)}, now(), now())`;
  await yonetim.$executeRaw`INSERT INTO cari_hesaplar (id, tenant_id, kod, unvan, tip, created_at, updated_at) VALUES (${cariId}::uuid, ${tenantId}::uuid, 'DG-1', 'Test Cari', 'musteri', now(), now())`;
  await yonetim.$executeRaw`INSERT INTO faturalar (id, tenant_id, tip, durum, tarih, cari_id, toplam_brut, toplam_satir_iskontosu, genel_iskonto_toplam, toplam_matrah, toplam_kdv, toplam_tevkifat, toplam_net_kdv, genel_toplam, created_at, updated_at) VALUES (${faturaId}::uuid, ${tenantId}::uuid, 'satis', 'taslak', now(), ${cariId}::uuid, 0, 0, 0, 0, 0, 0, 0, 0, now(), now())`;
});

afterAll(async () => {
  await uygulama.$disconnect();
  await yonetim.$disconnect();
});

describe("belge durum geçmişi tetikleyicisi (EBLG-35)", () => {
  it("fatura ve e-Belge durum değişikliğini değiştiren kullanıcıyla yazar; aynı değer satır üretmez", async () => {
    await baglamda(userId, async (tx) => {
      await tx.fatura.update({ where: { id: faturaId }, data: { durum: "kesin" } });
      await tx.ebelgeKayit.create({ data: { tenantId, faturaId, tur: "earsiv", durum: "kuyrukta" } });
      await tx.ebelgeKayit.update({ where: { faturaId }, data: { durum: "iletildi" } });
      await tx.ebelgeKayit.update({ where: { faturaId }, data: { durum: "iletildi" } });
    });

    const satirlar = await baglamda(userId, (tx) =>
      tx.belgeDurumGecmisi.findMany({ where: { faturaId }, orderBy: [{ createdAt: "asc" }] }),
    );
    expect(satirlar.map((s) => [s.eksen, s.eskiDurum, s.yeniDurum])).toEqual([
      ["fatura", null, "taslak"],
      ["fatura", "taslak", "kesin"],
      ["ebelge", null, "kuyrukta"],
      ["ebelge", "kuyrukta", "iletildi"],
    ]);
    expect(satirlar.slice(1).every((s) => s.userId === userId)).toBe(true);
  });

  it("alıcı yanıtını ayrı eksende gerekçesiyle yazar; geçersiz kullanıcı kimliği güncellemeyi bozmaz", async () => {
    await baglamda("gecersiz-kimlik", (tx) =>
      tx.ebelgeKayit.update({ where: { faturaId }, data: { aliciYaniti: "ret", aliciYanitNotu: "Fiyat hatalı" } }),
    );
    const yanit = await baglamda(userId, (tx) => tx.belgeDurumGecmisi.findFirst({ where: { faturaId, eksen: "alici_yaniti" } }));
    expect(yanit).toMatchObject({ yeniDurum: "ret", aciklama: "Fiyat hatalı", userId: null });
  });

  it("uygulama rolü geçmişi değiştiremez ve silemez", async () => {
    await expect(baglamda(userId, (tx) => tx.belgeDurumGecmisi.updateMany({ where: { faturaId }, data: { yeniDurum: "x" } }))).rejects.toThrow();
    await expect(baglamda(userId, (tx) => tx.belgeDurumGecmisi.deleteMany({ where: { faturaId } }))).rejects.toThrow();
  });

  it("başka kiracının bağlamında geçmiş görünmez", async () => {
    const sayi = await uygulama.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${randomUUID()}, true)`;
      return tx.belgeDurumGecmisi.count({ where: { faturaId } });
    });
    expect(sayi).toBe(0);
  });
});
