import { describe, expect, it } from "vitest";
import { cekOcrDogrula, cekOcrGirdiSemasi, cekOcrSonucSemasi, type CekOcrVerisi } from "./cek-ocr";
const belge = (ek: Partial<CekOcrVerisi> = {}): CekOcrVerisi => ({ belgeTuru: "CEK", cekNo: "0012345", banka: "Test Banka", sube: "Test",
  hesapNo: "000123", borclu: "Test Şirket", kesideYeri: "İstanbul", tarih: "2026-12-31", tutar: "10000.00", paraBirimi: "TRY",
  yaziylaTutar: "On bin Türk lirası", yaziylaTutarSayisal: "10000", guvenSkoru: 0.95, belirsizAlanlar: [], ...ek });
describe("çek/senet OCR doğrulaması", () => {
  it("çek numarası/hesap numarası başındaki sıfırları ve kuruşları korur", () => {
    expect(cekOcrDogrula(cekOcrSonucSemasi.parse(belge())).veri).toMatchObject({ cekNo: "0012345", hesapNo: "000123", tutar: "10000.00" });
  });
  it("rakam-yazı uyuşmazlığında tutarı doldurmaz", () => {
    const s = cekOcrDogrula(belge({ yaziylaTutarSayisal: "1000" }));
    expect(s.veri.tutar).toBeNull(); expect(s.uyarilar.join(" ")).toContain("farklı");
  });
  it.each([null, "0", "-1", "1.234,56", "100.123", "10000000000000"])("geçersiz tutarı boş bırakır: %s", (tutar) => {
    expect(cekOcrDogrula(belge({ tutar })).veri.tutar).toBeNull();
  });
  it.each([null, "2026-02-29", "2026-13-01", "31/12/2026"])("belirsiz/geçersiz tarihi bugüne çevirmeden boş bırakır: %s", (tarih) => {
    expect(cekOcrDogrula(belge({ tarih })).veri.tarih).toBeNull();
  });
  it("bilinmeyen dövizi TRY varsaymaz ve düşük güveni bildirir", () => {
    const s = cekOcrDogrula(belge({ paraBirimi: null, guvenSkoru: 0.3, belirsizAlanlar: ["banka"] }));
    expect(s.veri.paraBirimi).toBeNull(); expect(s.uyarilar.join(" ")).toContain("güven düşük");
  });
  it("bilinmeyen belgeyi uyarır, eksik modeli yüksek güvenle kabul etmez", () => {
    expect(cekOcrDogrula(belge({ belgeTuru: "BILINMIYOR" })).uyarilar.join(" ")).toContain("tanınmadı");
    expect(cekOcrSonucSemasi.safeParse({ belgeTuru: "CEK" }).success).toBe(false);
  });
  it("PDF, metin, fazla alan ve boş görsel girişini reddeder", () => {
    expect(cekOcrGirdiSemasi.safeParse({ gorselBase64: "x", mimeType: "application/pdf" }).success).toBe(false);
    expect(cekOcrGirdiSemasi.safeParse({ hamMetin: "çek" }).success).toBe(false);
    expect(cekOcrGirdiSemasi.safeParse({ gorselBase64: "", mimeType: "image/png" }).success).toBe(false);
  });
});
