import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { stokKartiBul } from "./stok-eslesme";

type Where = { kod?: string; barkod?: string };

/** Varyant TSH-S (barkod 869) TSH kartına bağlı; ana kart kodu TSH. */
const tx = {
  stokVaryant: {
    findFirst: async ({ where }: { where: Where }) =>
      where.kod === "TSH-S" || where.barkod === "869" ? { id: "v1", stokId: "k1" } : null,
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
});
