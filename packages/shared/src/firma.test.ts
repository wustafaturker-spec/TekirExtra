import { describe, expect, it } from "vitest";
import { firmaEbelgeEksikleri, mersisNoGecerliMi } from "./firma";

describe("firma e-belge bilgisi (EBLG-62)", () => {
  it("adres, ilçe, il ve vergi dairesi olmadan gönderimi durdurur", () => {
    expect(firmaEbelgeEksikleri({})[0]).toContain("adres, ilçe, il, vergi dairesi");
    expect(firmaEbelgeEksikleri({ adres: "Maltepe Mh", ilce: "Zeytinburnu", il: "İstanbul", vergiDairesi: "Davutpaşa" })).toEqual([]);
    expect(firmaEbelgeEksikleri({ adres: " ", ilce: "Zeytinburnu", il: "İstanbul", vergiDairesi: "Davutpaşa" })[0]).toContain("adres eksik");
  });

  it("MERSİS numarası boş ya da 16 hane olmalı", () => {
    expect(mersisNoGecerliMi(null)).toBe(true);
    expect(mersisNoGecerliMi("0524000463400019")).toBe(true);
    expect(mersisNoGecerliMi("052400046340")).toBe(false);
  });
});
