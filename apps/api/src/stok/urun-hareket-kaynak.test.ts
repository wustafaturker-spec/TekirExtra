import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { kaynakEtiketi, maliyetHucreleri } from "./urun-hareket.raporlar";

const F = "0d9b07a4-0000-4000-8000-000000000001", T = "0d9b07a4-0000-4000-8000-000000000002";
const b = { faturalar: new Map<string, string | null>([[F, "K072026000000081"]]), transferler: new Map([[T, "TRF2026000001"]]) };

describe("ürün hareket kaynağı (RPR-19)", () => {
  it("fatura kimliği numaraya ve bağlantıya çevrilir", () => {
    expect(kaynakEtiketi({ kaynakTur: "fatura", kaynakRef: F }, b)).toEqual({ kaynak: "Fatura K072026000000081", kaynakYolu: `/panel/fatura/yeni?ac=${F}` });
    expect(kaynakEtiketi({ kaynakTur: "fatura_iptal", kaynakRef: F }, b).kaynak).toBe("Fatura iptali K072026000000081");
  });

  it("numarasız fatura, transfer, üretim ve elle giriş okunur", () => {
    const n = { ...b, faturalar: new Map<string, string | null>([[F, null]]) };
    expect(kaynakEtiketi({ kaynakTur: "fatura", kaynakRef: F }, n).kaynak).toBe("Fatura Numarasız");
    expect(kaynakEtiketi({ kaynakTur: "transfer", kaynakRef: T }, b).kaynak).toBe("Transfer TRF2026000001");
    expect(kaynakEtiketi({ kaynakTur: "uretim_bildirimi_sarf", kaynakRef: "anahtar" }, b).kaynak).toBe("Üretim bildirimi");
    expect(kaynakEtiketi({ kaynakTur: "manuel", kaynakRef: null }, b)).toEqual({ kaynak: "Elle giriş", kaynakYolu: null });
  });

  it("maliyeti kayıtlı olmayan çıkış boş, giriş 0 kalır", () => {
    expect(maliyetHucreleri(new Prisma.Decimal(-2), new Prisma.Decimal(0))).toEqual({ birimMaliyet: null, toplamMaliyet: null });
    expect(maliyetHucreleri(new Prisma.Decimal(2), new Prisma.Decimal(0)).toplamMaliyet).toBe("0.00");
    expect(maliyetHucreleri(new Prisma.Decimal(-2), new Prisma.Decimal(5)).toplamMaliyet).toBe("10.00");
  });
});
