import { describe, expect, it, vi } from "vitest";
import { geriAlinanHareketler, iptalCiftiMi, iptalEdilmisFaturalar, iptalleriGoster } from "./iptal-cifti";

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

describe("taslağa geri alınan hareketler (CARI-63/STK-42)", () => {
  const h = (id: string, kaynakTur: string, dk: number, kaynakRef: string | null = "f1", stokId = "s1") => ({ id, kaynakTur, kaynakRef, stokId, createdAt: new Date(Date.UTC(2026, 10, 8, 10, dk)) });

  it("taslakta kalan faturanın kesinleştirme ve ters kaydını gizler", () => {
    expect([...geriAlinanHareketler([h("k1", "fatura", 1), h("t1", "fatura_geri_alma", 2)])].sort()).toEqual(["k1", "t1"]);
  });
  it("yeniden kesinleşen faturada yalnız son kesinleştirme açık kalır", () => {
    const sonuc = geriAlinanHareketler([h("k3", "fatura", 5), h("k1", "fatura", 1), h("t1", "fatura_geri_alma", 2), h("k2", "fatura", 3), h("t2", "fatura_geri_alma", 4)]);
    expect([...sonuc].sort()).toEqual(["k1", "k2", "t1", "t2"]);
  });
  it("geri alma yoksa, başka kaynak ya da başka faturada hiçbir şeyi gizlemez", () => {
    expect(geriAlinanHareketler([h("k1", "fatura", 1), h("t", "fatura_iptal", 2), h("m", "manuel", 3, null)]).size).toBe(0);
    expect(geriAlinanHareketler([h("k1", "fatura", 1, "f2"), h("t1", "fatura_geri_alma", 2, "f1")])).toEqual(new Set(["t1"]));
  });
  it("stok anahtarıyla ters kaydı olmayan eski hizmet satırını gizlemez", () => {
    const sonuc = geriAlinanHareketler([h("hizmet", "fatura", 1, "f1", "s9"), h("mal", "fatura", 1, "f1", "s1"), h("t", "fatura_geri_alma", 2, "f1", "s1"), h("mal2", "fatura", 3, "f1", "s1")], (x) => `${x.kaynakRef}|${x.stokId}`);
    expect([...sonuc].sort()).toEqual(["mal", "t"]);
  });
});
