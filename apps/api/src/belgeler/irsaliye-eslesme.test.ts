import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { belgeNoSadelestir, faturaIrsaliyeAdaylari, irsaliyeAlisFiyati } from "./irsaliye-eslesme";

const D = (x: number) => new Prisma.Decimal(x);

describe("SAT-13 fatura–irsaliye numara eşlemesi", () => {
  const irsaliyeler = [
    { id: "a", no: "AIR2026000001", durum: "onaylandi", faturaId: null, tedarikciBelgeNo: "abc 2026000000012", gelenEirsaliye: null },
    { id: "b", no: "AIR2026000002", durum: "kapandi", faturaId: "f-baska", tedarikciBelgeNo: "ABC2026000000013", gelenEirsaliye: null },
    { id: "c", no: "AIR2026000003", durum: "onaylandi", faturaId: null, tedarikciBelgeNo: null, gelenEirsaliye: { belgeNo: "EIR2026000000009" } },
  ];
  const tx = {
    belge: { findMany: async () => irsaliyeler },
    gelenEirsaliye: { findFirst: async ({ where }: { where: { belgeNo: { equals: string } } }) => (where.belgeNo.equals === "GLN2026000000001" ? { id: "g" } : null) },
  } as unknown as Prisma.TransactionClient;

  it("tedarikçi no ya da gelen e-İrsaliye no ile eşler; boşluk/harf farkını yok sayar", async () => {
    const r = await faturaIrsaliyeAdaylari(tx, "t", "c1", ["ABC2026000000012", "abc2026000000013", "EIR2026000000009", "GLN2026000000001", "YOK1"]);
    expect(r.eslesen.map((e) => [e.id, e.faturaId])).toEqual([["a", null], ["b", "f-baska"], ["c", null]]);
    expect(r.bulunamayan).toEqual([{ no: "GLN2026000000001", durum: "islenmemis_eirsaliye" }, { no: "YOK1", durum: "yok" }]);
    expect(belgeNoSadelestir(" abc 12 ")).toBe("ABC12");
  });
});

describe("SAT-12 irsaliye satır fiyatı", () => {
  const tx = (ted: unknown, kart: unknown) => ({
    stokTedarikci: { findFirst: async () => ted },
    stokKart: { findUnique: async () => kart },
  }) as unknown as Prisma.TransactionClient;

  it("önce tedarikçinin fiyatı, yoksa kartın TL alış fiyatı, o da yoksa sıfır", async () => {
    expect(await irsaliyeAlisFiyati(tx({ alisFiyati: D(12.5) }, null), "s", "c")).toBe("12.5");
    expect(await irsaliyeAlisFiyati(tx(null, { alisFiyati: D(9), alisFiyatiDoviz: "TRY" }), "s", "c")).toBe("9");
    expect(await irsaliyeAlisFiyati(tx(null, { alisFiyati: D(9), alisFiyatiDoviz: "USD" }), "s", "c")).toBe("0");
  });
});
