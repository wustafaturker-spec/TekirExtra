import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { anaBirimMiktari, birimKatsayisiBul, satirBirimleriniDogrula } from "./birim-cevrim";

const kart = { id: "s1", ad: "Su", anaBirim: "adet", birimler: [{ ad: "koli", katsayi: new Prisma.Decimal(12) }] };
const tx = {
  stokKart: {
    findUnique: async ({ where }: { where: { id: string } }) => (where.id === kart.id ? kart : null),
    findMany: async () => [kart],
  },
  stokBirim: {
    findFirst: async ({ where }: { where: { ad: string } }) => kart.birimler.find((b) => b.ad === where.ad) ?? null,
  },
} as unknown as Prisma.TransactionClient;

describe("birim çevrimi (STK-10)", () => {
  it("ana birim 1, ek birim katsayısı kadar sayılır", async () => {
    expect((await birimKatsayisiBul(tx, "s1", "adet")).toNumber()).toBe(1);
    expect((await birimKatsayisiBul(tx, "s1", "koli")).toNumber()).toBe(12);
    expect((await anaBirimMiktari(tx, { stokId: "s1", birim: "koli", miktar: new Prisma.Decimal(3) })).toNumber()).toBe(36);
  });

  it("kartta olmayan birim reddedilir", async () => {
    await expect(birimKatsayisiBul(tx, "s1", "kg")).rejects.toThrow("'kg' birimi tanımlı değil");
    await expect(satirBirimleriniDogrula(tx, [{ stokId: "s1", birim: "koli" }, { stokId: "s1", birim: "kg" }])).rejects.toThrow("Satır 2");
    await expect(satirBirimleriniDogrula(tx, [{ stokId: "s1", birim: "adet" }])).resolves.toBeUndefined();
  });
});
