import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { dovizIslemHesapla } from "./doviz-islem-hesap";

const D = (v: string | number) => new Prisma.Decimal(v);

describe("dovizIslemHesapla", () => {
  it("döviz bozdurmada TCMB alışın üstündeki banka kuru kambiyo kârıdır", () => {
    const s = dovizIslemHesapla({ cikanTutar: D(1000), cikanDoviz: "USD", cikanKur: D("41.00"), girenTutar: D(41250), girenDoviz: "TRY", girenKur: D(1) });
    expect(s.cikanTry.toFixed(2)).toBe("41000.00");
    expect(s.fark.toFixed(2)).toBe("250.00");
    expect(s.kurAciklamasi).toBe("1 USD = 41.2500 TL (satış)");
  });

  it("döviz alımında TCMB alışın üstünde ödenen tutar kambiyo zararıdır", () => {
    const s = dovizIslemHesapla({ cikanTutar: D(41500), cikanDoviz: "TRY", cikanKur: D(1), girenTutar: D(1000), girenDoviz: "USD", girenKur: D("41.00") });
    expect(s.fark.toFixed(2)).toBe("-500.00");
    expect(s.bankaKuru.toFixed(4)).toBe("41.5000");
  });

  it("iki döviz arasında iki bacak kendi TCMB kuruyla değerlenir", () => {
    const s = dovizIslemHesapla({ cikanTutar: D(1000), cikanDoviz: "EUR", cikanKur: D("48.00"), girenTutar: D(1160), girenDoviz: "USD", girenKur: D("41.00") });
    expect(s.cikanTry.toFixed(2)).toBe("48000.00");
    expect(s.girenTry.toFixed(2)).toBe("47560.00");
    expect(s.fark.toFixed(2)).toBe("-440.00");
    expect(s.kurAciklamasi).toBe("1 EUR = 1.1600 USD (çapraz)");
  });
});
