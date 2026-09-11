import { describe, expect, it } from "vitest";
import { earsivRaporTutariOzetle } from "@tekirextra/baglanti";

describe("earsivRaporTutariOzetle (EBLG-07)", () => {
  it("bildirilen belgeleri para birimine göre toplar, iptal kayıtlarını ayrı tutar", () => {
    const tutar = earsivRaporTutariOzetle("rapor-1", [
      { documentNumber: "SNC2026000000001", payableAmount: 1200, documentCurrencyCode: "TRY" },
      { documentNumber: "SNC2026000000002", payableAmount: 120.5, documentCurrencyCode: "TRY" },
      { documentNumber: "SNC2026000000003", payableAmount: 50, documentCurrencyCode: "USD" },
      { documentNumber: "SNC2026000000001", payableAmount: 1200, documentCurrencyCode: "TRY", isCancelRecord: true },
    ]);

    expect(tutar).toEqual({
      uuid: "rapor-1",
      bildirilen: [
        { paraBirimi: "TRY", tutar: "1320.50", belgeSayisi: 2 },
        { paraBirimi: "USD", tutar: "50.00", belgeSayisi: 1 },
      ],
      iptal: [{ paraBirimi: "TRY", tutar: "1200.00", belgeSayisi: 1 }],
    });
  });

  it("kuruşları kaydırmadan toplar", () => {
    const satirlar = Array.from({ length: 300 }, () => ({ payableAmount: 0.1, documentCurrencyCode: "TRY" }));
    expect(earsivRaporTutariOzetle("r", satirlar).bildirilen).toEqual([{ paraBirimi: "TRY", tutar: "30.00", belgeSayisi: 300 }]);
  });

  it("boş dökümde toplam listesi boş kalır, para birimi yoksa TRY sayılır", () => {
    expect(earsivRaporTutariOzetle("r", [])).toEqual({ uuid: "r", bildirilen: [], iptal: [] });
    expect(earsivRaporTutariOzetle("r", [{ payableAmount: 10 }]).bildirilen).toEqual([{ paraBirimi: "TRY", tutar: "10.00", belgeSayisi: 1 }]);
  });
});
