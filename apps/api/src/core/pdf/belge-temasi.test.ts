import { describe, expect, it } from "vitest";
import {
  BELGE_SABLONLARI,
  VARSAYILAN_TEMA,
  VARSAYILAN_VURGU_RENGI,
  okunakliMetin,
  renkKoyult,
  renkNormalize,
  renkTonu,
  sablonNormalize,
  sayfaStili,
} from "./belge-temasi";

describe("renk yardımcıları (FTR-23)", () => {
  it("geçersiz rengi varsayılana düşürür", () => {
    expect(renkNormalize("#ABCDEF")).toBe("#abcdef");
    expect(renkNormalize("mavi")).toBe(VARSAYILAN_VURGU_RENGI);
    expect(renkNormalize("#abc")).toBe(VARSAYILAN_VURGU_RENGI);
    expect(renkNormalize(undefined)).toBe(VARSAYILAN_VURGU_RENGI);
  });

  it("vurgu rengine göre okunur yazı rengi seçer", () => {
    expect(okunakliMetin("#111827")).toBe("#ffffff");
    expect(okunakliMetin(VARSAYILAN_VURGU_RENGI)).toBe("#ffffff");
    expect(okunakliMetin("#fde047")).toBe("#111827");
    expect(okunakliMetin("#ffffff")).toBe("#111827");
  });

  it("tonu beyaza, koyultmayı siyaha taşır", () => {
    expect(renkTonu("#000000", 1)).toBe("#ffffff");
    expect(renkTonu("#000000", 0)).toBe("#000000");
    expect(renkKoyult("#ffffff", 1)).toBe("#000000");
    expect(renkTonu("#6d28d9", 0.5)).toBe("#b694ec");
  });

  it("sınır dışı oranları kırpar", () => {
    expect(renkTonu("#6d28d9", 5)).toBe("#ffffff");
    expect(renkKoyult("#6d28d9", -3)).toBe("#6d28d9");
  });
});

describe("sayfaStili (FTR-22)", () => {
  it("bilinmeyen şablon standarda düşer", () => {
    expect(sablonNormalize("uzay")).toBe("standart");
    expect(sayfaStili({ sablon: "uzay" as never, vurguRengi: "#6d28d9" })).toBe(sayfaStili(VARSAYILAN_TEMA));
  });

  it("varsayılan temada standart şablonun bugünkü rengini korur", () => {
    const stil = sayfaStili(VARSAYILAN_TEMA);
    expect(stil).toContain("background: #6d28d9");
    // Tablo başlığı standart şablonda vurgu renginden bağımsızdır.
    expect(stil).toContain("background: #1e1b4b");
  });

  it("her şablon farklı bir stil üretir", () => {
    const stiller = BELGE_SABLONLARI.map((sablon) => sayfaStili({ sablon, vurguRengi: "#0f766e" }));
    expect(new Set(stiller).size).toBe(BELGE_SABLONLARI.length);
  });

  it("vurgu rengi şablonlara işler", () => {
    expect(sayfaStili({ sablon: "modern", vurguRengi: "#0f766e" })).toContain("#0f766e");
    expect(sayfaStili({ sablon: "klasik", vurguRengi: "#0f766e" })).toContain("#0f766e");
  });

  it("yabancı görüntüleyicide çalışmayan CSS üretmez", () => {
    for (const sablon of BELGE_SABLONLARI) {
      const stil = sayfaStili({ sablon, vurguRengi: "#0f766e" });
      expect(stil).not.toContain("var(--");
      expect(stil).not.toContain("color-mix");
      expect(stil).not.toContain("display: grid");
    }
  });

  it("açık vurgu renginde üst şerit yazısı koyulaşır", () => {
    expect(sayfaStili({ sablon: "standart", vurguRengi: "#fde047" })).toContain("color: #111827");
  });
});
