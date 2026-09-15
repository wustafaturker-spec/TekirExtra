import { describe, expect, it, vi } from "vitest";
import { iptalCiftiMi, iptalEdilmisFaturalar, iptalleriGoster } from "./iptal-cifti";

describe("iptal çifti (CARI-22, STK-22)", () => {
  it("yalnız fatura kaynaklı hareketlerin faturalarını sorar", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "f-iptal" }]);
    const tx = { fatura: { findMany } } as never;

    const iptaller = await iptalEdilmisFaturalar(tx, [
      { kaynakTur: "fatura", kaynakRef: "f-iptal" },
      { kaynakTur: "fatura_iptal", kaynakRef: "f-iptal" },
      { kaynakTur: "fatura", kaynakRef: "f-kesin" },
      { kaynakTur: "kasa_tahsilat", kaynakRef: "k1" },
      { kaynakTur: "manuel", kaynakRef: null },
    ]);

    expect(findMany).toHaveBeenCalledWith({ where: { id: { in: ["f-iptal", "f-kesin"] }, durum: "iptal" }, select: { id: true } });
    expect([...iptaller]).toEqual(["f-iptal"]);
  });

  it("fatura kaynaklı hareket yoksa sorgu yapmaz", async () => {
    const findMany = vi.fn();
    await expect(iptalEdilmisFaturalar({ fatura: { findMany } } as never, [{ kaynakTur: "manuel", kaynakRef: null }])).resolves.toEqual(new Set());
    expect(findMany).not.toHaveBeenCalled();
  });

  it("iptal edilmiş faturanın hareketini, ters hareketini ve telafisini çift sayar", () => {
    const iptaller = new Set(["f1"]);
    for (const kaynakTur of ["fatura", "fatura_iptal", "fatura_iptal_duzeltme"]) {
      expect(iptalCiftiMi({ kaynakTur, kaynakRef: "f1" }, iptaller)).toBe(true);
    }
    expect(iptalCiftiMi({ kaynakTur: "fatura", kaynakRef: "f2" }, iptaller)).toBe(false);
    // Başka kaynağın referansı tesadüfen aynı olsa da çift sayılmaz.
    expect(iptalCiftiMi({ kaynakTur: "kasa_tahsilat", kaynakRef: "f1" }, iptaller)).toBe(false);
  });

  it("gösterme tercihini sorgu parametresinden ve rapor filtresinden okur", () => {
    expect(iptalleriGoster("1")).toBe(true);
    expect(iptalleriGoster("true")).toBe(true);
    expect(iptalleriGoster(true)).toBe(true);
    expect(iptalleriGoster(undefined)).toBe(false);
    expect(iptalleriGoster("0")).toBe(false);
  });
});
