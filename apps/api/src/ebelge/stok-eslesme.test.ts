import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { stokKartiBul, tedarikciVaryantKodlariniOgren } from "./stok-eslesme";

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

describe("tedarikçi varyant kodunu öğrenme (STK-23)", () => {
  function sahteTx(kartKodu: string | null) {
    const yazilan: { varyantId: string; kod: string }[] = [];
    const silinen: unknown[] = [];
    const tx = {
      stokTedarikci: {
        findFirst: async () => ({ id: "t1", tedarikciUrunKodu: kartKodu }),
        create: async () => ({ id: "t1", tedarikciUrunKodu: null }),
      },
      stokTedarikciVaryant: {
        deleteMany: async (a: unknown) => { silinen.push(a); return { count: 0 }; },
        upsert: async ({ create }: { create: { varyantId: string; tedarikciUrunKodu: string } }) => { yazilan.push({ varyantId: create.varyantId, kod: create.tedarikciUrunKodu }); return {}; },
      },
    } as unknown as Prisma.TransactionClient;
    return { tx, yazilan, silinen };
  }

  it("varyanta bağlanan satırın kodunu öğrenir; varyantsız satırı atlar", async () => {
    const { tx, yazilan, silinen } = sahteTx(null);
    const n = await tedarikciVaryantKodlariniOgren(tx, "t", "c1", [
      { saticiUrunKodu: "A-S", stokId: "k1", varyantId: "v1" },
      { saticiUrunKodu: "B", stokId: "k2", varyantId: null },
    ]);
    expect(n).toBe(1);
    expect(yazilan).toEqual([{ varyantId: "v1", kod: "A-S" }]);
    expect(silinen).toHaveLength(1); // aynı kod başka varyanttaysa taşınır
  });

  it("aynı kod iki ayrı varyanta bağlıysa ya da kart düzeyindeki kodsa öğrenmez", async () => {
    const iki = sahteTx(null);
    expect(await tedarikciVaryantKodlariniOgren(iki.tx, "t", "c1", [
      { saticiUrunKodu: "A", stokId: "k1", varyantId: "v1" },
      { saticiUrunKodu: "A", stokId: "k1", varyantId: "v2" },
    ])).toBe(0);
    const kart = sahteTx("A");
    expect(await tedarikciVaryantKodlariniOgren(kart.tx, "t", "c1", [{ saticiUrunKodu: "A", stokId: "k1", varyantId: "v1" }])).toBe(0);
    expect(kart.yazilan).toEqual([]);
  });
});
