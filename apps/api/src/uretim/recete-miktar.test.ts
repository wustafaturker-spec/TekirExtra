import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { duzMiktar, emirMalzemeMiktari, receteBirimKatsayisi } from "./recete-miktar";
import { receteKaydetSemasi } from "./uretim.semalar";

const D = (v: string) => new Prisma.Decimal(v);
const kalem = (miktar: string, fireOrani = "0") => ({ kalemler: [{ malzemeStokId: "11111111-1111-4111-8111-111111111111", miktar, fireOrani }] });

describe("reçete hassasiyeti", () => {
  it("reçete miktarı 8, fire 6 ondalık alır; fazlası reddedilir", () => {
    expect(receteKaydetSemasi.safeParse(kalem("0.00000698", "0.003500")).success).toBe(true);
    expect(receteKaydetSemasi.safeParse(kalem("0.000000001")).success).toBe(false);
    expect(receteKaydetSemasi.safeParse(kalem("1", "0.0000001")).success).toBe(false);
    expect(receteKaydetSemasi.safeParse(kalem("1", "100.5")).success).toBe(false);
    expect(receteKaydetSemasi.safeParse(kalem("0")).success).toBe(false);
  });

  it("kg kartına mg/g, litre kartına ml ek birim tanımlamadan çevrilir", async () => {
    const tx = {} as Prisma.TransactionClient;
    expect((await receteBirimKatsayisi(tx, { id: "k", anaBirim: "kg" }, "mg")).toFixed()).toBe("0.000001");
    expect((await receteBirimKatsayisi(tx, { id: "k", anaBirim: "litre" }, "ml")).toFixed()).toBe("0.001");
    expect((await receteBirimKatsayisi(tx, { id: "k", anaBirim: "kg" }, null)).toFixed()).toBe("1");
    // 6,98 mg → kg kayıpsız
    expect(D("6.98").mul(await receteBirimKatsayisi(tx, { id: "k", anaBirim: "kg" }, "mg")).toFixed()).toBe("0.00000698");
  });

  it("aile dışı birim kartın ek biriminden okunur", async () => {
    const tx = {
      stokKart: { findUnique: async () => ({ anaBirim: "adet", ad: "Vida" }) },
      stokBirim: { findFirst: async () => ({ katsayi: D("12") }) },
    } as unknown as Prisma.TransactionClient;
    expect((await receteBirimKatsayisi(tx, { id: "k", anaBirim: "adet" }, "koli")).toFixed()).toBe("12");
  });

  it("emir ihtiyacı ana birimde 3 basamağa yuvarlanır; ham değer korunur", () => {
    const { ham, miktar } = emirMalzemeMiktari(D("0.00000698"), D("10"), D("0"));
    expect(ham.toFixed()).toBe("0.0000698");
    expect(miktar.isZero()).toBe(true);
    expect(emirMalzemeMiktari(D("0.00000698"), D("10000"), D("2.5")).miktar.toFixed()).toBe("0.072");
  });

  it("küçük miktar üstel yazılmaz, sondaki sıfırlar atılır", () => {
    expect(duzMiktar(D("0.00000001"))).toBe("0.00000001");
    expect(duzMiktar(D("2.500000"))).toBe("2.5");
    expect(duzMiktar(D("3"))).toBe("3");
    expect(duzMiktar(null)).toBeNull();
  });
});
