import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * KSB-09: makbuz numarası veritabanı tetikleyicisiyle verilir. Test uygulama
 * rolüyle (RLS altında) kendi kiracısında çalışır; tür/yıl başına ayrı sıra,
 * iç fişlerin numara almaması, yeni yılın öneki sürdürmesi, numaranın
 * yanması ve eşzamanlı kayıtta tekillik doğrulanır.
 */

const yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
const uygulama = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

const tenantId = randomUUID();
const kasaId = randomUUID();

function baglamda<T>(fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>) {
  return uygulama.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

const fis = (tip: "tahsilat" | "tediye" | "virman_gidis", tarih: string, kaynakTur = "manuel") =>
  baglamda((tx) => tx.kasaBankaHareket.create({
    data: { tenantId, kasaId, tip, tutar: "10", tutarTry: "10", tarih: new Date(tarih), kaynakTur },
    select: { id: true, makbuzNo: true },
  }));

beforeAll(async () => {
  await yonetim.$executeRaw`INSERT INTO tenants (id, unvan, vkn, created_at, updated_at) VALUES (${tenantId}::uuid, 'Makbuz No Test', ${String(Date.now()).slice(-10)}, now(), now())`;
  await yonetim.$executeRaw`INSERT INTO kasalar (id, tenant_id, ad, created_at, updated_at) VALUES (${kasaId}::uuid, ${tenantId}::uuid, 'Merkez', now(), now())`;
});

afterAll(async () => {
  await uygulama.$disconnect();
  await yonetim.$disconnect();
});

describe("makbuz numarası tetikleyicisi (KSB-09)", () => {
  it("tahsilat ve tediye ayrı seride, fiş yılına göre sıralanır; iç fişler numara almaz", async () => {
    expect((await fis("tahsilat", "2026-03-01")).makbuzNo).toBe("TM2026-000001");
    expect((await fis("tahsilat", "2026-03-02")).makbuzNo).toBe("TM2026-000002");
    expect((await fis("tediye", "2026-03-02")).makbuzNo).toBe("TD2026-000001");
    expect((await fis("tahsilat", "2025-12-31")).makbuzNo).toBe("TM2025-000001");
    expect((await fis("virman_gidis", "2026-03-02")).makbuzNo).toBeNull();
    for (const kaynak of ["ters_kayit", "cek_senet", "kredi_karti_ekstre", "pos_mutabakat", "personel_maas_iptal"]) {
      expect((await fis("tediye", "2026-03-02", kaynak)).makbuzNo).toBeNull();
    }
    expect((await fis("tediye", "2026-03-03", "masraf")).makbuzNo).toBe("TD2026-000002");
  });

  it("silinen fişin numarası yanar; yeni yıl serisi önceki yılın önekini sürdürür", async () => {
    const silinecek = await fis("tahsilat", "2026-04-01");
    expect(silinecek.makbuzNo).toBe("TM2026-000003");
    await baglamda((tx) => tx.kasaBankaHareket.delete({ where: { id: silinecek.id } }));
    expect((await fis("tahsilat", "2026-04-01")).makbuzNo).toBe("TM2026-000004");

    await baglamda((tx) => tx.makbuzSeri.updateMany({ where: { tur: "tahsilat", yil: 2026 }, data: { onek: "KM" } }));
    expect((await fis("tahsilat", "2027-01-02")).makbuzNo).toBe("KM2027-000001");
  });

  it("eşzamanlı kayıtlar boşluksuz ve tekil numara alır", async () => {
    const sonuclar = await Promise.all(Array.from({ length: 8 }, () => fis("tediye", "2028-05-05")));
    const numaralar = sonuclar.map((s) => s.makbuzNo).sort();
    expect(numaralar).toEqual(Array.from({ length: 8 }, (_, i) => `TD2028-${String(i + 1).padStart(6, "0")}`));
  });

  it("başka kiracının serisini görmez", async () => {
    const seriler = await uygulama.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${randomUUID()}, true)`;
      return tx.makbuzSeri.findMany();
    });
    expect(seriler).toEqual([]);
  });
});
