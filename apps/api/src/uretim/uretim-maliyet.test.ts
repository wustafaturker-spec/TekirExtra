import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ekGiderTutari, operasyonKirilimi } from "./uretim-maliyet";

describe("reçete ek gideri", () => {
  const D = (v: number | string) => new Prisma.Decimal(v);
  const girdi = { malzeme: D(1000), miktar: D(40), emirMiktari: D(100) };
  it("malzeme yüzdesi bu miktarın malzeme maliyetine uygulanır", () => {
    expect(ekGiderTutari({ yontem: "malzeme_yuzdesi", deger: D(8) }, girdi).toFixed()).toBe("80");
  });
  it("birim başı üretilen miktarla çarpılır", () => {
    expect(ekGiderTutari({ yontem: "birim_basi", deger: D("2.5") }, girdi).toFixed()).toBe("100");
  });
  it("emir başı gider üretilen orana göre dağıtılır; parçaların toplamı tutarı aşmaz", () => {
    expect(ekGiderTutari({ yontem: "emir_basi", deger: D(500) }, girdi).toFixed()).toBe("200");
    expect(ekGiderTutari({ yontem: "emir_basi", deger: D(500) }, { ...girdi, miktar: D(60) }).toFixed()).toBe("300");
  });
});

describe("operasyon kırılımı", () => {
  it("dakika × saatlik / 60 her bileşen için ayrı hesaplanır", () => {
    const D = (v: number) => new Prisma.Decimal(v);
    const k = operasyonKirilimi({ dakika: D(90), iscilikSaatlik: D(200), makineSaatlik: D(100), genelGiderSaatlik: D(40) });
    expect([k.iscilik.toFixed(), k.makine.toFixed(), k.genelGider.toFixed()]).toEqual(["300", "150", "60"]);
  });
});
