import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { raporTanimiAl } from "../core/raporlar/rapor-kayit";
import "./stok.raporlar";

const stok = { kod: "HZM-1", ad: "Deneme Hizmeti" };
const hareket = (tip: string, miktar: string, kaynakTur: string, kaynakRef: string | null) => ({
  stokId: "s1", tip, miktar: new Prisma.Decimal(miktar), kaynakTur, kaynakRef, stok,
});

/**
 * Fatura f-iptal iptal edilmiş: çıkışı (-1000), iptalin eskiden işaretli yazdığı
 * hatalı girişi (-1000) ve telafisi (+2000). f-kesin gerçek satış (-11), a1 alış.
 */
const hareketler = [
  hareket("giris", "1000", "fatura", "a1"),
  hareket("cikis", "-11", "fatura", "f-kesin"),
  hareket("cikis", "-1000", "fatura", "f-iptal"),
  hareket("giris", "-1000", "fatura_iptal", "f-iptal"),
  hareket("giris", "2000", "fatura_iptal_duzeltme", "f-iptal"),
];

async function calistir(filtreler: Record<string, unknown>) {
  const tx = {
    stokHareket: { findMany: vi.fn().mockResolvedValue(hareketler) },
    fatura: { findMany: vi.fn().mockResolvedValue([{ id: "f-iptal" }]) },
  };
  return raporTanimiAl("stok.hareket-ozeti")!.calistir({ filtreler }, { tx } as never);
}

describe("stok.hareket-ozeti (STK-22)", () => {
  it("iptal edilmiş faturanın hareketlerini varsayılan olarak saymaz", async () => {
    const [satir] = await calistir({});
    expect(satir).toMatchObject({ giris: 1000, cikis: 11, net: 989 });
  });

  it("iptaller sayılınca giriş/çıkış büyür ama net değişim stok bakiyesiyle aynı kalır", async () => {
    // Eksi miktarlı hatalı giriş mutlak değerle toplanınca net 3023 çıkıyordu.
    const [satir] = await calistir({ iptaller: true });
    expect(satir.net).toBe(989);
    expect(satir).toMatchObject({ giris: 2000, cikis: 1011 });
  });
});
