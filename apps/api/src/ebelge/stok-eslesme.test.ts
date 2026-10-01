import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { stokKartiBul, tedarikciKodlariniOgren } from "./stok-eslesme";

type Where = { kod?: string; barkod?: string; stok?: { ad?: { equals: string } } };

/** Varyant TSH-S (barkod 869) TSH kartına bağlı; ana kart kodu TSH. */
const tx = {
  stokVaryant: {
    findFirst: async ({ where }: { where: Where }) =>
      where.kod === "TSH-S" || where.barkod === "869" ? { id: "v1", stokId: "k1" } : null,
    findMany: async ({ where }: { where: Where }) =>
      where.stok?.ad?.equals === "Tişört" ? [{ id: "v0", stokId: "k1", ad: "Mavi / M" }, { id: "v1", stokId: "k1", ad: "Mavi / S" }] : [],
  },
  stokKart: { findFirst: async ({ where }: { where: Where }) => (where.kod === "TSH" ? { id: "k1" } : null) },
  stokBarkod: { findFirst: async () => null },
  stokTedarikci: { findFirst: async ({ where }: { where: { tedarikciUrunKodu?: string } }) => (where.tedarikciUrunKodu === "ACME-TSH" ? { stokId: "k1" } : null) },
  // Tedarikçi c1, S varyantına ACME-TSH-S kodunu vermiş (STK-23).
  stokTedarikciVaryant: {
    findFirst: async ({ where }: { where: { tedarikciUrunKodu: string; stokTedarikci?: { cariId: string } } }) =>
      where.tedarikciUrunKodu === "ACME-TSH-S" && (!where.stokTedarikci || where.stokTedarikci.cariId === "c1") ? { varyant: { id: "v1", stokId: "k1" } } : null,
  },
} as unknown as Prisma.TransactionClient;

describe("gelen belge satırı → stok kartı/varyant", () => {
  it("bizim kodumuz ya da barkod bir varyantınsa satır o varyanta eşleşir", async () => {
    expect(await stokKartiBul(tx, "t", { aliciUrunKodu: "TSH-S" }, null)).toEqual({ stokId: "k1", varyantId: "v1", kaynak: "alici_urun_kodu" });
    expect(await stokKartiBul(tx, "t", { barkod: "869" }, null)).toEqual({ stokId: "k1", varyantId: "v1", kaynak: "barkod" });
  });

  it("ana kart koduyla eşleşen satırda varyant boş kalır (ekranda seçilir)", async () => {
    expect(await stokKartiBul(tx, "t", { aliciUrunKodu: "TSH" }, null)).toEqual({ stokId: "k1", varyantId: null, kaynak: "alici_urun_kodu" });
  });

  it("\"Ürün — Varyant\" adlı satır ürün ve varyant adıyla eşleşir; nitelik sırası önemsiz", async () => {
    expect(await stokKartiBul(tx, "t", { ad: "Tişört — S / Mavi" }, null)).toEqual({ stokId: "k1", varyantId: "v1", kaynak: "ad" });
  });

  it("tedarikçinin varyant kodu satırı o varyanta düşürür; başka tedarikçide eşleşmez", async () => {
    expect(await stokKartiBul(tx, "t", { saticiUrunKodu: "ACME-TSH-S" }, "c1")).toEqual({ stokId: "k1", varyantId: "v1", kaynak: "tedarikci_urun_kodu" });
    expect(await stokKartiBul(tx, "t", { saticiUrunKodu: "ACME-TSH-S" }, "c2")).toEqual({ stokId: null, varyantId: null, kaynak: null });
  });

  it("kart düzeyindeki tedarikçi kodu kartı bulur, varyant boş kalır", async () => {
    expect(await stokKartiBul(tx, "t", { saticiUrunKodu: "ACME-TSH" }, "c1")).toEqual({ stokId: "k1", varyantId: null, kaynak: "tedarikci_urun_kodu" });
  });
});

describe("tedarikçi kodunu öğrenme (STK-23)", () => {
  function sahteTx(kartKodu: string | null) {
    const yazilan: { varyantId: string; kod: string }[] = [];
    const kartaYazilan: { id: string; kod: string }[] = [];
    const silinen: unknown[] = [];
    const bosaltilan: unknown[] = [];
    const tx = {
      stokTedarikci: {
        findFirst: async () => ({ id: "t1", tedarikciUrunKodu: kartKodu }),
        create: async () => ({ id: "t1", tedarikciUrunKodu: null }),
        updateMany: async (a: unknown) => { bosaltilan.push(a); return { count: 0 }; },
        update: async ({ where, data }: { where: { id: string }; data: { tedarikciUrunKodu: string } }) => { kartaYazilan.push({ id: where.id, kod: data.tedarikciUrunKodu }); return {}; },
      },
      stokTedarikciVaryant: {
        deleteMany: async (a: unknown) => { silinen.push(a); return { count: 0 }; },
        upsert: async ({ create }: { create: { varyantId: string; tedarikciUrunKodu: string } }) => { yazilan.push({ varyantId: create.varyantId, kod: create.tedarikciUrunKodu }); return {}; },
      },
    } as unknown as Prisma.TransactionClient;
    return { tx, yazilan, kartaYazilan, silinen, bosaltilan };
  }

  it("varyanta bağlanan satırın kodunu varyanta, varyantsız satırınkini karta yazar", async () => {
    const { tx, yazilan, kartaYazilan, silinen } = sahteTx(null);
    const n = await tedarikciKodlariniOgren(tx, "t", "c1", [
      { saticiUrunKodu: "A-S", stokId: "k1", varyantId: "v1" },
      { saticiUrunKodu: "B", stokId: "k2", varyantId: null },
    ]);
    expect(n).toBe(2);
    expect(yazilan).toEqual([{ varyantId: "v1", kod: "A-S" }]);
    expect(kartaYazilan).toEqual([{ id: "t1", kod: "B" }]);
    expect(silinen).toHaveLength(2); // kod başka varyanttaysa taşınır / karta düzeltildiyse varyanttan silinir
  });

  it("aynı kod iki ayrı varyanta bağlıysa ya da kart düzeyindeki kodsa varyanta öğrenmez", async () => {
    const iki = sahteTx(null);
    expect(await tedarikciKodlariniOgren(iki.tx, "t", "c1", [
      { saticiUrunKodu: "A", stokId: "k1", varyantId: "v1" },
      { saticiUrunKodu: "A", stokId: "k1", varyantId: "v2" },
    ])).toBe(0);
    const kart = sahteTx("A");
    expect(await tedarikciKodlariniOgren(kart.tx, "t", "c1", [{ saticiUrunKodu: "A", stokId: "k1", varyantId: "v1" }])).toBe(0);
    expect(kart.yazilan).toEqual([]);
  });

  it("aynı kod iki ayrı karta bağlıysa karta öğrenmez", async () => {
    const { tx, kartaYazilan, bosaltilan } = sahteTx(null);
    expect(await tedarikciKodlariniOgren(tx, "t", "c1", [
      { saticiUrunKodu: "A", stokId: "k1" },
      { saticiUrunKodu: "A", stokId: "k2" },
    ])).toBe(0);
    expect(kartaYazilan).toEqual([]);
    expect(bosaltilan).toEqual([]);
  });

  it("kartta bu tedarikçinin başka kodu varsa üzerine yazmaz; kodu başka karttan yine de kaldırır", async () => {
    const { tx, kartaYazilan, bosaltilan, silinen } = sahteTx("ESKI");
    expect(await tedarikciKodlariniOgren(tx, "t", "c1", [{ saticiUrunKodu: "YENI", stokId: "k1" }])).toBe(0);
    expect(kartaYazilan).toEqual([]);
    expect(bosaltilan).toEqual([{ where: { tenantId: "t", cariId: "c1", tedarikciUrunKodu: "YENI", stokId: { not: "k1" } }, data: { tedarikciUrunKodu: null } }]);
    expect(silinen).toHaveLength(1);
  });
});
