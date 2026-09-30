import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { stokKartiBul } from "./stok-eslesme";

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
  stokTedarikci: { findFirst: async () => null },
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
});
