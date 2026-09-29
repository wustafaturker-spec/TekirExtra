import { describe, expect, it } from "vitest";
import { birlesikReferanslar, referansFarkiUyarisi, referansNotlari, siparisReferansi } from "./musteri-referansi";

describe("müşteri talep/sipariş referansı (FTR-31)", () => {
  it("OrderReference'a sipariş numarası, yoksa talep numarası gider", () => {
    expect(siparisReferansi({ siparisNo: " PO-7 ", siparisTarihi: "2026-09-20", talepNo: "RFQ-1" })).toEqual({ no: "PO-7", tarih: "2026-09-20", kaynak: "siparis" });
    expect(siparisReferansi({ siparisNo: "  ", talepNo: "RFQ-1", talepTarihi: "2026-09-10" })).toEqual({ no: "RFQ-1", tarih: "2026-09-10", kaynak: "talep" });
    expect(siparisReferansi({})).toBeNull();
  });

  it("birleşen belgelerde ilk dolu referansı alır, farklıları ayırır", () => {
    const r = birlesikReferanslar([
      { siparisNo: null, talepNo: "RFQ-1" },
      { siparisNo: "PO-1", siparisTarihi: "2026-09-01", talepNo: "RFQ-1" },
      { siparisNo: "PO-2", talepNo: "RFQ-2" },
      { siparisNo: "PO-1" },
    ]);
    expect(r).toMatchObject({ siparisNo: "PO-1", siparisTarihi: "2026-09-01", talepNo: "RFQ-1", digerSiparisNolari: ["PO-2"], digerTalepNolari: ["RFQ-2"] });
  });

  it("referanslar tekse uyarı vermez, farklıysa hepsini sayar", () => {
    expect(referansFarkiUyarisi([{ siparisNo: "PO-1" }, { siparisNo: "PO-1" }, {}])).toBeNull();
    expect(referansFarkiUyarisi([{ siparisNo: "PO-1" }, { siparisNo: "PO-2" }])).toContain("sipariş referansları farklı (PO-1, PO-2)");
  });

  it("talep referansını sipariş varken not olarak, diğer belgelerinkini ayrıca yazar", () => {
    expect(referansNotlari({ siparisNo: "PO-1", talepNo: "RFQ-1", talepTarihi: new Date("2026-09-10T00:00:00Z") })).toEqual(["Müşteri talep ref.: RFQ-1 (10.09.2026)"]);
    // Talep OrderReference'a gittiyse ayrıca not düşülmez.
    expect(referansNotlari({ talepNo: "RFQ-1" })).toEqual([]);
    expect(referansNotlari({ siparisNo: "PO-1" }, [{ siparisNo: "PO-1" }, { siparisNo: "PO-2", talepNo: "RFQ-9" }]))
      .toEqual(["Diğer sipariş ref.: PO-2", "Diğer talep ref.: RFQ-9"]);
    // Faturadaki numara silinmişse bağlı belgelerinki "diğer" sayılır.
    expect(referansNotlari({}, [{ siparisNo: "PO-1" }])).toEqual(["Diğer sipariş ref.: PO-1"]);
  });
});
