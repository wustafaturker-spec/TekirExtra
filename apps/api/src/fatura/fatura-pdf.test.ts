import { describe, expect, it } from "vitest";
import { EARSIV_ELEKTRONIK_IBARESI, faturaPdfHtml, profilAdi, type FaturaPdfVerisi } from "./fatura-pdf";

const fatura: FaturaPdfVerisi = {
  tip: "satis",
  durum: "kesin",
  no: "SNC2026000000004",
  tarih: "2026-09-11",
  vadeTarihi: null,
  dovizCinsi: "TRY",
  kur: "1",
  toplamBrut: "100.00",
  toplamSatirIskontosu: "0.00",
  genelIskontoToplam: "0.00",
  toplamMatrah: "100.00",
  toplamKdv: "20.00",
  toplamTevkifat: "0.00",
  genelToplam: "120.00",
  aciklama: null,
  cari: { kod: "C-1", unvan: "Ayşe Yılmaz", vknTckn: "10000000078" },
  satirlar: [],
};
const firma = { unvan: "Satıcı A.Ş.", vkn: "1234567801", vergiDairesi: null };

describe("faturaPdfHtml — e-Arşiv ibaresi (EBLG-26)", () => {
  it("elektronik iletilen e-Arşivde ibareyi yazar", () => {
    const html = faturaPdfHtml({ ...fatura, ebelge: { tur: "earsiv" }, earsivGonderimSekli: "elektronik" }, firma);
    expect(html).toContain(EARSIV_ELEKTRONIK_IBARESI);
  });

  it("kâğıt teslim edilen e-Arşivde ibareyi yazmaz", () => {
    const html = faturaPdfHtml({ ...fatura, ebelge: { tur: "earsiv" }, earsivGonderimSekli: "kagit" }, firma);
    expect(html).not.toContain(EARSIV_ELEKTRONIK_IBARESI);
  });

  it("e-Fatura ve henüz gönderilmemiş faturada ibareyi yazmaz", () => {
    expect(faturaPdfHtml({ ...fatura, ebelge: { tur: "efatura" }, earsivGonderimSekli: "elektronik" }, firma)).not.toContain(EARSIV_ELEKTRONIK_IBARESI);
    expect(faturaPdfHtml({ ...fatura, ebelge: null }, firma)).not.toContain(EARSIV_ELEKTRONIK_IBARESI);
  });
});

describe("faturaPdfHtml — e-belge kimliği (EBLG-30)", () => {
  const kimlikli = {
    ...fatura,
    id: "11111111-1111-4111-8111-111111111111",
    senaryo: "TEVKIFAT",
    efaturaProfili: "ticari",
  };

  it("gönderilen belgede ETTN, senaryo ve profili yazar", () => {
    const html = faturaPdfHtml({ ...kimlikli, ebelge: { tur: "efatura" } }, firma);
    expect(html).toContain("ETTN: 11111111-1111-4111-8111-111111111111");
    expect(html).toContain("TEVKIFAT");
    expect(html).toContain("TICARIFATURA");
  });

  it("e-Arşiv kanalında profil EARSIVFATURA'dır", () => {
    expect(profilAdi({ ebelge: { tur: "earsiv" }, efaturaProfili: "ticari" })).toBe("EARSIVFATURA");
    expect(profilAdi({ ebelge: { tur: "efatura" }, efaturaProfili: "temel" })).toBe("TEMELFATURA");
  });

  it("gönderilmemiş faturada kimlik satırı yoktur — ETTN'in henüz anlamı yok", () => {
    const html = faturaPdfHtml({ ...kimlikli, ebelge: null }, firma);
    expect(html).not.toContain("ETTN");
    expect(profilAdi({ ebelge: null })).toBeNull();
  });
});
