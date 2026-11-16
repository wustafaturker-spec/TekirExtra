import { describe, expect, it } from "vitest";
import { ettnleriBul, faturaNumaralariniBul } from "./fatura-referansi";

const simdi = new Date("2026-11-16T09:00:00Z");

describe("fatura referansı ayrıştırma (KSB-44)", () => {
  it("GİB biçimini (3 karakter + 4 hane yıl + 9 hane sıra) yıl ön ekine bağlı olmadan tanır", () => {
    expect(faturaNumaralariniBul("FATURA SNC2026000000123 ODEMESI", simdi)).toEqual(["SNC2026000000123"]);
    expect(faturaNumaralariniBul("EFT GIB2027000000001", simdi)).toEqual(["GIB2027000000001"]);
    expect(faturaNumaralariniBul("ESKI A1B2019000004567 BORCU", simdi)).toEqual(["A1B2019000004567"]);
    expect(faturaNumaralariniBul("snc2026000000123 nolu fatura", simdi)).toEqual(["SNC2026000000123"]);
  });
  it("harfe yapışık numarayı da bulur; birden çok numarayı tekrarsız döndürür", () => {
    expect(faturaNumaralariniBul("FTNOSNC2026000000123NOLU", simdi)).toEqual(["SNC2026000000123"]);
    expect(faturaNumaralariniBul("ABC2026000000001,ABC2026000000002 ABC2026000000001", simdi)).toEqual(["ABC2026000000001", "ABC2026000000002"]);
  });
  it("kart/hesap numarası, makul olmayan yıl, sıfır sıra ve uzun rakam dizisi fatura sayılmaz", () => {
    expect(faturaNumaralariniBul("KART 4543600012345678", simdi)).toEqual([]);
    expect(faturaNumaralariniBul("ABC1999000000001 ABC2028000000001", simdi)).toEqual([]);
    expect(faturaNumaralariniBul("ABC2026000000000", simdi)).toEqual([]);
    expect(faturaNumaralariniBul("ABC20260000000011", simdi)).toEqual([]);
    expect(faturaNumaralariniBul("ABC202600000001", simdi)).toEqual([]);
  });
  it("ETTN'i fatura numarasından ayrı ayrıştırır ve küçük harfe indirger", () => {
    const metin = "ODEME ETTN:3F2B6C1E-8D4A-4C2B-9A1E-5B7C8D9E0F12 FATURA SNC2026000000123";
    expect(ettnleriBul(metin)).toEqual(["3f2b6c1e-8d4a-4c2b-9a1e-5b7c8d9e0f12"]);
    expect(faturaNumaralariniBul(metin, simdi)).toEqual(["SNC2026000000123"]);
    expect(ettnleriBul("3f2b6c1e-8d4a-4c2b-9a1e-5b7c8d9e0f12A")).toEqual([]);
    expect(ettnleriBul("3f2b6c1e8d4a4c2b9a1e5b7c8d9e0f12")).toEqual([]);
  });
});
