import { describe, expect, it, vi } from "vitest";
import { cariAdaylari, kurumsalAlanAdi, telefonAnahtari, unvanBenzerligi, unvanKelimeleri } from "./cari-aday";

describe("yaklaşık cari adayları (AI-44)", () => {
  it("unvan ekleri ve Türkçe harf farkları sayılmaz", () => {
    expect(unvanKelimeleri("ABC Yapı Malzemeleri San. ve Tic. Ltd. Şti.")).toEqual(["abc", "yapi", "malzemeleri"]);
    expect(unvanBenzerligi("ABC YAPI MALZEMELERİ LTD.ŞTİ.", "Abc Yapı Malzemeleri Sanayi Ticaret A.Ş.")).toBe(1);
    expect(unvanBenzerligi("Demir Yapı", "Ayla Demir")).toBe(0.5);
    // Yalnız kısa kelime ortaksa benzer sayılmaz.
    expect(unvanBenzerligi("ABC Ltd", "ABC Gıda")).toBe(0);
  });

  it("telefon son 10 hane; ortak/ücretsiz/pazaryeri alan adı kurumsal değildir", () => {
    expect(telefonAnahtari("+90 (212) 555 00 00")).toBe("2125550000");
    expect(telefonAnahtari("0212 555 00 00")).toBe("2125550000");
    expect(telefonAnahtari("555 00")).toBeNull();
    expect(kurumsalAlanAdi("ayla@abc-yapi.com.tr")).toBe("abc-yapi.com.tr");
    for (const a of ["x@gmail.com", "x@Hotmail.com", "z9k3@trendyolmail.com", "q@hepsifatura.com"]) expect(kurumsalAlanAdi(a)).toBeNull();
  });

  function tx(o: { vkn?: string[]; telefon?: string[]; alanKart?: string[]; alanKisi?: string[]; unvanKart?: Array<{ id: string; unvan: string }> }) {
    return {
      cariHesap: {
        findMany: vi.fn(async (q: { where: Record<string, any> }) => {
          if (q.where.vknTckn) return (o.vkn ?? []).map((id) => ({ id }));
          if (q.where.eposta?.endsWith) return (o.alanKart ?? []).map((id) => ({ id }));
          if (q.where.aramaNormal) return o.unvanKart ?? [];
          if (q.where.id?.in) return q.where.id.in.map((id: string) => ({ id, kod: id, unvan: `U ${id}`, vknTckn: null }));
          return [];
        }),
      },
      cariKisi: { findMany: vi.fn().mockResolvedValue((o.alanKisi ?? []).map((cariId) => ({ cariId }))) },
      $queryRaw: vi.fn().mockResolvedValue((o.telefon ?? []).map((id) => ({ id }))),
    };
  }

  it("ipuçlarını birleştirip puana göre sıralar; yalnız tek VKN güçlüdür", async () => {
    const t = tx({ vkn: ["c1"], telefon: ["c2", "c1"], alanKart: ["c2"], unvanKart: [{ id: "c3", unvan: "ABC Yapı Malzemeleri Ltd" }] });
    const a = await cariAdaylari(t as never, "t", { eposta: "ayla@abc-yapi.com.tr", vknTckn: "1234567890", telefon: "02125550000", unvan: "ABC Yapı Malzemeleri Ltd. Şti." });
    expect(a.map((x) => [x.cariId, x.guclu])).toEqual([["c1", true], ["c2", false], ["c3", false]]);
    expect(a[1].gerekceler).toEqual(["telefon eşleşti", "alan adı abc-yapi.com.tr"]);
  });

  it("aynı VKN iki caride ya da alan adı birden çok caride ise güçlü/ipucu sayılmaz", async () => {
    const t = tx({ vkn: ["c1", "c2"], alanKart: ["c3"], alanKisi: ["c4"] });
    const a = await cariAdaylari(t as never, "t", { eposta: "x@grup.com", vknTckn: "1234567890" });
    expect(a.every((x) => !x.guclu)).toBe(true);
    expect(a.map((x) => x.cariId).sort()).toEqual(["c1", "c2"]);
  });

  it("geçersiz VKN ve ücretsiz posta adresi sorgu bile üretmez", async () => {
    const t = tx({});
    expect(await cariAdaylari(t as never, "t", { eposta: "x@gmail.com", vknTckn: "12AB" })).toEqual([]);
    expect(t.cariHesap.findMany).not.toHaveBeenCalled();
  });
});
