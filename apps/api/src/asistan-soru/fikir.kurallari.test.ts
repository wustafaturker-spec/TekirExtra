import { describe, expect, it } from "vitest";
import {
  anlatimGecerliMi, erkenOdemeAdayi, fikirDugmesi, fikirDugmesiCoz, fikirleriSec, gecOdemeAdayi, isoHafta, marjAdayi, metindekiSayilar, yavasStokAdayi, type FikirAdayi,
} from "./fikir.kurallari";

const simdi = new Date("2026-11-16T09:00:00Z");

describe("haftalık fikir adayları (CNL-11)", () => {
  it("marj: iki dönemde de ciro varsa ve en az 5 puan düştüyse; en büyük etkili ürün", () => {
    const son = [{ stokId: "a", kod: "A1", ad: "Alfa", ciro: 20000, marj: 18 }, { stokId: "b", kod: "B1", ad: "Beta", ciro: 50000, marj: 29 }, { stokId: "c", kod: "C1", ad: "Gama", ciro: 500, marj: 1 }];
    const once = [{ stokId: "a", ciro: 60000, marj: 30 }, { stokId: "b", ciro: 90000, marj: 31 }, { stokId: "c", ciro: 5000, marj: 40 }];
    const a = marjAdayi(son, once)!;
    expect(a).toMatchObject({ tur: "marj", varlikId: "a", etkiTl: 2400, raporKodu: "stok.urun-karlilik" });
    expect(a.metin).toContain("Alfa (A1) ürününde marj son 30 günde %18; önceki 90 günde %30 idi (12 puan düşüş)");
    expect(marjAdayi([{ stokId: "a", ciro: 20000, marj: null }], once)).toBeNull();
  });

  it("yavaş stok: bağlı sermaye en az 1.000 TL; en büyük üç ürün", () => {
    const a = yavasStokAdayi([{ kod: "X", ad: "X", envanterDegeri: 400 }, { kod: "Y", ad: "Y", envanterDegeri: 9000 }, { kod: "Z", ad: "Z", envanterDegeri: 600 }, { kod: "W", ad: "W", envanterDegeri: 50 }])!;
    expect(a.etkiTl).toBe(10050);
    expect(a.metin).toContain("4 üründe 90 gündür hareket yok; bağlı sermaye 10.050,00 TL. En büyükleri: Y (Y) 9.000,00 TL, Z (Z) 600,00 TL, X (X) 400,00 TL");
    expect(yavasStokAdayi([{ kod: "X", ad: "X", envanterDegeri: 999 }])).toBeNull();
  });

  it("geç ödeme: ortalama süre vadeyi en az 15 gün aşmalı; vade yoksa 30 gün", () => {
    const vadeler = new Map([["c1", { vadeGun: 30, riskLimiti: null }], ["c2", { vadeGun: null, riskLimiti: 50000 }]]);
    const a = gecOdemeAdayi([{ cariId: "c1", unvan: "Bir", ortalamaGun: 40, acikBakiye: 90000 }, { cariId: "c2", unvan: "İki", ortalamaGun: 52, acikBakiye: 20000 }], vadeler)!;
    expect(a).toMatchObject({ varlikId: "c2", etkiTl: 20000 });
    expect(a.metin).toContain("İki ortalama 52 günde ödüyor; anlaşılan vade 30 gün");
    expect(a.metin).toContain("risk limitini (50.000,00 TL) gözden geçirin");
  });

  it("erken ödeme: borç ≥ 5.000 TL ve en düşük nakit borcun 1,2 katı; %2 örneklenir", () => {
    const b = [{ cariId: "t1", unvan: "Ted", kalan: 100000, vade: "2026-12-20" }, { cariId: "t2", unvan: "Küçük", kalan: 6000, vade: "2026-12-01" }];
    expect(erkenOdemeAdayi(130000, b)).toMatchObject({ varlikId: "t1", etkiTl: 2000 });
    expect(erkenOdemeAdayi(110000, b)).toBeNull();
    expect(erkenOdemeAdayi(1e9, [{ cariId: "x", unvan: "X", kalan: 4000, vade: "2026-12-01" }])).toBeNull();
  });
});

describe("fikir seçimi ve işaretler", () => {
  const aday = (tur: FikirAdayi["tur"], varlikId: string | null, etkiTl: number) => ({ tur, varlikId, etkiTl, baslik: "", metin: "", olgular: {}, raporKodu: null, hedefYol: "/" }) as FikirAdayi;
  const adaylar = [aday("marj", "a", 1000), aday("yavas_stok", null, 900), aday("gec_odeme", "c", 800), aday("erken_odeme", "t", 700)];

  it("en çok üç, etkiye göre", () => {
    expect(fikirleriSec(adaylar, [], simdi).map((a) => a.tur)).toEqual(["marj", "yavas_stok", "gec_odeme"]);
  });

  it("getirme türü kapatır; yaramaz aynı kaydı 90 gün getirmez; yarar türü öne alır", () => {
    const isaretler = [
      { tur: "marj" as const, varlikId: null, isaret: "getirme" as const, at: simdi },
      { tur: "gec_odeme" as const, varlikId: "c", isaret: "yaramaz" as const, at: new Date(simdi.getTime() - 10 * 86_400_000) },
      { tur: "erken_odeme" as const, varlikId: "t", isaret: "yarar" as const, at: simdi },
    ];
    expect(fikirleriSec(adaylar, isaretler, simdi).map((a) => a.tur)).toEqual(["erken_odeme", "yavas_stok"]);
    const eski = [{ tur: "gec_odeme" as const, varlikId: "c", isaret: "yaramaz" as const, at: new Date(simdi.getTime() - 100 * 86_400_000) }];
    // 90 günü geçen "yaramaz" kaydı engellemez (tek aday seçilir) ama türün ağırlığını düşürmeyi sürdürür.
    expect(fikirleriSec([adaylar[2]], eski, simdi).map((a) => a.tur)).toEqual(["gec_odeme"]);
    expect(fikirleriSec(adaylar, eski, simdi).map((a) => a.tur)).toEqual(["marj", "yavas_stok", "erken_odeme"]);
  });
});

describe("model anlatımı denetimi: model rakam üretmez", () => {
  const a = { metin: "X ürününde marj %18; önceki %30 (12 puan). Ciro 20.000,00 TL.", olgular: { marjSon: 18, marjOnce: 30, dusus: 12, ciroSon: 20000, etki: 2400 } };
  it("olgulardaki sayılarla yazılan anlatım geçer, yeni sayı içeren reddedilir", () => {
    expect(anlatimGecerliMi("X ürününün marjı %30'dan %18'e indi; son 30 günde 20.000 TL ciro yaptı, kâr kaybı 2.400 TL.", { ...a, metin: `${a.metin} son 30 gün` })).toBe(true);
    expect(anlatimGecerliMi("Marj %18'e indi; fiyatı %7 artırırsanız 3.500 TL kazanırsınız.", a)).toBe(false);
    expect(anlatimGecerliMi("Kısa.", a)).toBe(false);
  });

  it("Türkçe sayı biçimleri değere çevrilir", () => {
    expect(metindekiSayilar("1.250.000,50 TL, %2 ve 30 gün")).toEqual([1250000.5, 2, 30]);
  });
});

describe("yardımcılar", () => {
  it("ISO hafta", () => {
    expect(isoHafta("2026-11-16")).toBe("2026-W47");
    expect(isoHafta("2026-11-15")).toBe("2026-W46");
    expect(isoHafta("2027-01-01")).toBe("2026-W53");
    expect(isoHafta("2021-01-04")).toBe("2021-W01");
  });

  it("Telegram fikir düğmesi 64 baytı aşmaz ve çözülür", () => {
    const v = fikirDugmesi("11111111-2222-4333-8444-555555555555", "yaramaz");
    expect(Buffer.byteLength(v)).toBeLessThanOrEqual(64);
    expect(fikirDugmesiCoz(v)).toEqual({ fikirId: "11111111-2222-4333-8444-555555555555", isaret: "yaramaz" });
    expect(fikirDugmesiCoz("f:x:yarar")).toBeNull();
  });
});
