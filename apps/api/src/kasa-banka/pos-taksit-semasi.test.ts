import { describe, expect, it } from "vitest";
import { posHesapGuncelleSemasi, posHesapOlusturSemasi } from "./kasa-banka.semalar";

const temel = { ad: "iyzico TL", saglayici: "iyzico" as const, baglantiId: "8b0c6c1e-6f5e-4a51-9f1a-0c2b1d6f7a10" };

describe("KSB-35 POS hesabı taksit şeması", () => {
  it("taksitleri sıralar, işlem ücretini kabul eder", () => {
    const s = posHesapGuncelleSemasi.parse({ islemUcreti: "0.25", taksitOranlari: [{ taksit: 6, oran: "5.9" }, { taksit: 3, oran: "3.49" }] });
    expect(s.taksitOranlari?.map((t) => t.taksit)).toEqual([3, 6]);
  });
  it("tekrarlanan, aralık dışı taksiti ve eksi ücreti reddeder", () => {
    expect(posHesapGuncelleSemasi.safeParse({ taksitOranlari: [{ taksit: 3, oran: "3" }, { taksit: 3, oran: "4" }] }).success).toBe(false);
    expect(posHesapGuncelleSemasi.safeParse({ taksitOranlari: [{ taksit: 1, oran: "3" }] }).success).toBe(false);
    expect(posHesapGuncelleSemasi.safeParse({ taksitOranlari: [{ taksit: 13, oran: "3" }] }).success).toBe(false);
    expect(posHesapGuncelleSemasi.safeParse({ islemUcreti: "-1" }).success).toBe(false);
  });
  it("dövizli POS hesabında taksit tanımlanmaz", () => {
    expect(posHesapOlusturSemasi.safeParse({ ...temel, dovizCinsi: "USD", taksitOranlari: [{ taksit: 3, oran: "3" }] }).success).toBe(false);
    expect(posHesapOlusturSemasi.safeParse({ ...temel, dovizCinsi: "TRY", taksitOranlari: [{ taksit: 3, oran: "3" }] }).success).toBe(true);
  });
});
