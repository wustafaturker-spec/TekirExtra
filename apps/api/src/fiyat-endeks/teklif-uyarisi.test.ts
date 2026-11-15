import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { teklifUyarilari } from "./teklif-uyarisi";

const D = (v: string) => new Prisma.Decimal(v);
const endeks = new Map([["2026-08-01", D("100")], ["2026-10-01", D("103")]]);
const temel = { teklifAyi: "2026-08-01", endeks, endeksAdi: "TÜFE", esik: { kur: 3, endeks: 2 } };

describe("END-20 teklif geçerlilik uyarısı", () => {
  it("dövizli teklif: belge kuru ile bugünkü kur eşiği aşarsa; endeks son açıklanan aya kadar", () => {
    const u = teklifUyarilari({ ...temel, doviz: "USD", oncekiKur: D("40"), bugunkuKur: D("41.6"), kurDovizi: "USD" });
    expect(u.map((x) => [x.tur, x.degisim])).toEqual([["kur", "4.00"], ["endeks", "3.00"]]);
    expect(u[0].mesaj).toMatch(/Teklif kuru 40\.0000/);
  });
  it("TL teklif: USD değişimi; eşik altı uyarı yok; teklif ayı açıklanmamışsa endeks karşılaştırılmaz", () => {
    expect(teklifUyarilari({ ...temel, doviz: "TRY", oncekiKur: D("40"), bugunkuKur: D("41"), kurDovizi: "USD", teklifAyi: "2026-11-01" })).toEqual([]);
    expect(teklifUyarilari({ ...temel, doviz: "TRY", oncekiKur: D("40"), bugunkuKur: D("38"), kurDovizi: "USD", teklifAyi: "2026-11-01" })[0]).toMatchObject({ tur: "kur", degisim: "-5.00" });
  });
});
