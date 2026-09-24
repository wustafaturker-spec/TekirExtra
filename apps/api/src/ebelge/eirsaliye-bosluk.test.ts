import { describe, expect, it } from "vitest";
import { numaraBoslukTaslakHtml, numaraBosluklariniBul } from "./eirsaliye-bosluk";

/** EBLG-93: giden e-İrsaliye serisinde boşta kalan numaralar. */
describe("numaraBosluklariniBul", () => {
  const b = (sira: number, durum: string, eirsaliye: string | null) => ({
    id: `b${sira}`, no: `GBZ2026${String(sira).padStart(9, "0")}`, durum, tarih: new Date("2026-09-24"), eirsaliye: eirsaliye ? { durum: eirsaliye } : null,
  });

  it("atlanmış, GİB'e ulaşmadan iptal edilmiş ve bekleyen numaraları ayırır", () => {
    const sonuc = numaraBosluklariniBul({
      seriOneki: "GBZ", yil: 2026, sayacSonSira: 800007,
      belgeler: [
        b(800001, "kapandi", "kabul"),
        // 800002 hiçbir belgede yok → atlanmış
        b(800003, "iptal", null),
        b(800004, "iptal", "hata"),
        b(800005, "onaylandi", null),
        b(800006, "iptal", "iletildi"), // GİB'e ulaşmış: boşluk değil
        // 800007 sayaçta ama belgede yok → atlanmış
      ],
    });
    expect(sonuc.ilk).toBe("GBZ2026000800001");
    expect(sonuc.son).toBe("GBZ2026000800007");
    expect(sonuc.bosluklar.map((x) => [x.no.slice(-3), x.neden])).toEqual([
      ["002", "atlanmis"], ["003", "iptal_gonderilmedi"], ["004", "iptal_gonderilmedi"], ["007", "atlanmis"],
    ]);
    expect(sonuc.bekleyenler.map((x) => x.no.slice(-3))).toEqual(["005"]);
  });

  it("başka seri ya da yıldaki numaraları karıştırmaz; seri boşsa aralık yoktur", () => {
    const sonuc = numaraBosluklariniBul({ seriOneki: "GBZ", yil: 2026, sayacSonSira: 3, belgeler: [{ ...b(1, "kapandi", "kabul"), no: "AIR2026000001" }] });
    expect(sonuc).toMatchObject({ ilk: null, bosluklar: [], bekleyenler: [] });
  });

  it("dilekçe ve tutanak taslağı numaraları ve firmayı içerir", () => {
    const veri = numaraBosluklariniBul({ seriOneki: "GBZ", yil: 2026, sayacSonSira: 2, belgeler: [b(1, "kapandi", "kabul")] });
    const html = numaraBoslukTaslakHtml(veri, { unvan: "Tekir A.Ş.", vkn: "1234567801", vergiDairesi: "Kadıköy" }, new Date("2026-09-24T09:00:00Z"));
    expect(html).toContain("GELİR İDARESİ BAŞKANLIĞINA");
    expect(html).toContain("NUMARA ATLAMA TESPİT TUTANAĞI");
    expect(html.match(/GBZ2026000000002/g)).toHaveLength(2);
    expect(html).toContain("Kadıköy V.D.");
    const ekli = numaraBoslukTaslakHtml(veri, { unvan: "Tekir A.Ş.", vkn: "1234567801", vergiDairesi: "DAVUTPAŞA VD" }, new Date());
    expect(ekli).toContain("DAVUTPAŞA VD<");
    expect(ekli).not.toContain("VD V.D.");
  });
});
