import { describe, expect, it } from "vitest";
import { bakiyeYonu, ekstreAciklamasi, hareketTuruEtiketi, mutabakatMetni } from "./cari-ekstre";

describe("cari ekstre (CARI-24)", () => {
  it("hareket türünü fatura tipinden ve para yönünden adlandırır", () => {
    expect(hareketTuruEtiketi({ kaynakTur: "fatura", tip: "borc", faturaTipi: "satis" })).toBe("Satış");
    expect(hareketTuruEtiketi({ kaynakTur: "fatura", tip: "alacak", faturaTipi: "satis_iade" })).toBe("Satış iadesi");
    expect(hareketTuruEtiketi({ kaynakTur: "kasa_banka", tip: "alacak" })).toBe("Tahsilat");
    expect(hareketTuruEtiketi({ kaynakTur: "kasa_banka", tip: "borc" })).toBe("Ödeme");
    expect(hareketTuruEtiketi({ kaynakTur: "cek_senet", tip: "alacak" })).toBe("Çek/senet alındı");
    expect(hareketTuruEtiketi({ kaynakTur: "bordro_odeme", tip: "borc" })).toBe("Bordro");
    expect(hareketTuruEtiketi({ kaynakTur: "bilinmeyen", tip: "borc" })).toBe("Diğer");
  });

  it("faturanın otomatik açıklamasını gizler, elle yazılanı korur", () => {
    expect(ekstreAciklamasi("K072026000000041 nolu fatura hareketi", "fatura")).toBe("");
    expect(ekstreAciklamasi("Fatura hareketi", "fatura")).toBe("");
    expect(ekstreAciklamasi("Eylül hakedişi", "fatura")).toBe("Eylül hakedişi");
    expect(ekstreAciklamasi("GELEN EFT", "kasa_banka")).toBe("GELEN EFT");
    expect(ekstreAciklamasi(null, "manuel")).toBe("");
  });

  it("bakiye yönünü B/A olarak verir, sıfıra boş döner", () => {
    expect(bakiyeYonu(10)).toBe("B");
    expect(bakiyeYonu("-3.5")).toBe("A");
    expect(bakiyeYonu(0.001)).toBe("");
  });

  it("mutabakat metnini bakiyenin yönüyle yazar", () => {
    const metin = mutabakatMetni("2026-09-29", [{ dovizCinsi: "TL", bakiye: "633499" }, { dovizCinsi: "USD", bakiye: -120.5 }, { dovizCinsi: "EUR", bakiye: 0 }]);
    expect(metin).toContain("29.09.2026 tarihi itibarıyla");
    expect(metin).toContain("633.499,00 TL borç, 120,50 USD alacak");
    expect(metin).not.toContain("EUR");
    expect(mutabakatMetni("2026-09-29", [])).toContain("bakiyesiz");
  });
});
