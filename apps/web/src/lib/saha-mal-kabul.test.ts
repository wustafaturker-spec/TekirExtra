import { describe, expect, it } from "vitest";
import { kabulGovdesi, kabulPlani, type MalKabulBelgesi } from "./saha-mal-kabul";
import { miktarEkle } from "./saha-sayim";
import type { SahaUrunu } from "./saha-depo";

const vida: SahaUrunu = { id: "a", kod: "HM-001", ad: "Vida", anaBirim: "ADET", takipTipi: "yok", varyantlar: [] };
const ilac: SahaUrunu = { id: "c", kod: "IL-1", ad: "Şurup", anaBirim: "ADET", takipTipi: "lot", varyantlar: [] };
const somun: SahaUrunu = { id: "s", kod: "SM-1", ad: "Somun", anaBirim: "ADET", takipTipi: "yok", varyantlar: [] };

const belge = (satirlar: MalKabulBelgesi["satirlar"], tur: MalKabulBelgesi["tur"] = "siparis"): MalKabulBelgesi => ({ tur, id: "b", no: "SAS1", tarih: "2026-11-13", cariUnvan: "T", engel: null, satirlar });
const satir = (anahtar: string, stokId: string | null, beklenen: number, katsayi: number | null = 1, birim = "ADET") => ({ anahtar, stokId, varyantId: null, kod: null, ad: anahtar, birim, katsayi, beklenen, takipTipi: "yok" });

describe("kabulPlani (SAH-06)", () => {
  it("okunan miktar sırayla satırlara dağılır, fazlası ayrılır, eksik fark olarak görünür", () => {
    let okunan = miktarEkle([], vida, null, 7);
    okunan = miktarEkle(okunan, somun, null, 2);
    const p = kabulPlani(belge([satir("l1", "a", 5), satir("l2", "a", 1), satir("l3", "x", 4)]), okunan);
    expect(p.kalemler).toEqual([{ anahtar: "l1", stokId: "a", varyantId: null, miktar: "5" }, { anahtar: "l2", stokId: "a", varyantId: null, miktar: "1" }]);
    expect(p.fazla).toEqual([{ ad: "Vida", miktar: 1, birim: "ADET" }]);
    expect(p.beklenmeyen).toEqual([{ ad: "Somun", miktar: 2, birim: "ADET" }]);
    expect(p.durumlar.map((d) => d.fark)).toEqual([0, 0, -4]);
  });

  it("koli satırına ana birimde okunan miktar belge birimine çevrilir", () => {
    const p = kabulPlani(belge([satir("l1", "a", 3, 12, "KOLI")]), miktarEkle([], vida, null, 30));
    expect(p.kalemler[0].miktar).toBe("2.5");
    expect(p.durumlar[0].fark).toBe(-0.5);
  });

  it("lotlar satırlara bölünür; parti toplamı satır miktarını tutar", () => {
    let okunan = miktarEkle([], ilac, null, 4, { lotNo: "L1" });
    okunan = miktarEkle(okunan, ilac, null, 3, { lotNo: "L2" });
    const p = kabulPlani(belge([{ ...satir("l1", "c", 5), takipTipi: "lot" }, { ...satir("l2", "c", 5), takipTipi: "lot" }]), okunan);
    expect(p.kalemler).toEqual([
      { anahtar: "l1", stokId: "c", varyantId: null, miktar: "5", partiler: [{ lotNo: "L1", miktar: "4" }, { lotNo: "L2", miktar: "1" }] },
      { anahtar: "l2", stokId: "c", varyantId: null, miktar: "2", partiler: [{ lotNo: "L2", miktar: "2" }] },
    ]);
  });

  it("çevrimde yuvarlama farkı son partiye yazılır", () => {
    let okunan = miktarEkle([], ilac, null, 1, { lotNo: "L1" });
    okunan = miktarEkle(okunan, ilac, null, 1, { lotNo: "L2" });
    const p = kabulPlani(belge([{ ...satir("l1", "c", 1, 3, "PAKET"), takipTipi: "lot" }]), okunan);
    const k = p.kalemler[0];
    expect(k.miktar).toBe("0.667");
    expect(k.partiler!.reduce((t, x) => t + Number(x.miktar), 0)).toBeCloseTo(0.667, 6);
  });

  it("eşleşmeyen ya da birimi kartta olmayan satır kabul edilemez", () => {
    const p = kabulPlani(belge([satir("1", null, 2), satir("2", "a", 1, null, "PALET")], "eirsaliye"), miktarEkle([], vida, null, 1));
    expect(p.kalemler).toEqual([]);
    expect(p.durumlar.map((d) => Boolean(d.kabulEdilemez))).toEqual([true, true]);
    expect(p.beklenmeyen).toEqual([]);
    expect(p.fazla).toEqual([{ ad: "Vida", miktar: 1, birim: "ADET" }]);
  });

  it("gövde: siparişte satır kimliği, e-İrsaliyede sıra numarası", () => {
    const k = [{ anahtar: "3", stokId: "a", varyantId: null, miktar: "2" }];
    expect(kabulGovdesi(belge([], "siparis"), k)).toEqual({ kalemler: [{ satirId: "3", miktar: "2" }] });
    expect(kabulGovdesi(belge([], "eirsaliye"), k)).toEqual({ satirlar: [{ siraNo: 3, stokId: "a", varyantId: null, miktar: "2" }] });
  });
});
