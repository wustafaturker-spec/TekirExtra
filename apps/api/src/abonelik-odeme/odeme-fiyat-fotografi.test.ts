import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { abonelikTutari } from "./abonelik-tutari";
import { fiyatFotografiniDogrula, fiyatFotografiniOku, odemeFiyatFotografi } from "./odeme-fiyat-fotografi";

const fotograf = () => odemeFiyatFotografi(abonelikTutari("v1", 3)!);
describe("ödeme fiyat fotoğrafı", () => {
  it("eski kodu kanonik kodla, adı ve dönemin kesin tutarlarıyla sabitler", () => {
    expect(fotograf()).toEqual({ semaSurumu: 1, kaynak: "eski_sabit", planKodu: "profesyonel", planAdi: "Profesyonel", paraBirimi: "TRY", kdvOrani: "20", aySayisi: 3, matrah: "2997.00", kdv: "599.40", toplam: "3596.40" });
  });
  it.each([null, {}, { ...fotograf(), semaSurumu: 2 }, { ...fotograf(), paraBirimi: "USD" },
    { ...fotograf(), matrah: "2997.001" }, { ...fotograf(), kdvOrani: "101" },
    { ...fotograf(), kdv: "599.41" }, { ...fotograf(), toplam: "3596.41" },
    { ...fotograf(), planAdi: "" }, { ...fotograf(), aySayisi: 2 }, { ...fotograf(), ek: true },
  ])("bozuk fotoğraftan güncel koşullara düşmez: %j", (g) => {
    expect(() => fiyatFotografiniOku(g)).toThrow("fotoğraf");
  });
  it("yarım kuruş vergi ve sıfır oranı doğru doğrular", () => {
    const f = { ...fotograf(), matrah: "0.05", kdvOrani: "10", kdv: "0.01", toplam: "0.06" };
    expect(fiyatFotografiniOku(f)).toEqual(f);
    expect(fiyatFotografiniOku({ ...f, kdvOrani: "0", kdv: "0.00", toplam: "0.05" }).kdv).toBe("0.00");
  });
  it("kayıtla tutar, dönem ve plan uyuşmasını zorunlu tutar", () => {
    const kayit = abonelikTutari("profesyonel", 3)!;
    expect(fiyatFotografiniDogrula(fotograf(), kayit)).toEqual(fotograf());
    for (const ek of [{ aySayisi: 1 }, { planKodu: "baslangic" }, { matrah: null }, { kdv: null }, { toplam: new Prisma.Decimal("1") }]) {
      expect(() => fiyatFotografiniDogrula(fotograf(), { ...kayit, ...ek })).toThrow("kaydıyla uyuşmuyor");
    }
  });
});
