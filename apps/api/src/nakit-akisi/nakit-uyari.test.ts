import { describe, expect, it } from "vitest";
import { nakitEksiBildirimi } from "./nakit-uyari.service";

const kalem = (tarih: string, tutar: number, kaynak = "fatura", aciklama = "ABC Ltd. faturası") =>
  ({ yon: "cikis", tutar, kaynak, aciklama, vade: tarih, tarihler: { baz: { tarih } } }) as never;
const tahmin = (ilkEksi: { tarih: string; bakiye: number } | null, kalemler: never[] = []) =>
  ({ senaryolar: { baz: { ilkEksi } }, kalemler }) as never;

describe("nakit eksi bildirimi (CNL-06)", () => {
  it("bugün ya da yarın eksiye düşerse kritik bildirim, durum, rakam ve öneriyle", () => {
    const b = nakitEksiBildirimi(tahmin({ tarih: "2026-11-13", bakiye: -12500 }, [kalem("2026-11-13", 30000), kalem("2026-11-13", 5000, "masraf", "Kira"), kalem("2026-11-14", 99999)]), "2026-11-12")!;
    expect(b).toMatchObject({ tur: "vade", onem: "kritik", birlesimAnahtari: "nakit-eksi:2026-11-13", hedefYol: "/panel/nakit-akisi" });
    expect(b.baslik).toBe("Nakit yarın eksiye düşüyor: -12.500,00 TL");
    expect(b.aciklama).toContain("13.11.2026 günü -12.500,00 TL");
    expect(b.aciklama).toContain("beklenen çıkış 35.000,00 TL; en büyüğü ABC Ltd. faturası (30.000,00 TL)");
    expect(b.aciklama).toMatch(/Öneri:/);
  });

  it("daha ileri tarihte eksiye düşme ya da hiç düşmeme bildirim üretmez", () => {
    expect(nakitEksiBildirimi(tahmin({ tarih: "2026-11-14", bakiye: -1 }), "2026-11-12")).toBeNull();
    expect(nakitEksiBildirimi(tahmin(null), "2026-11-12")).toBeNull();
  });

  it("en büyük çıkış maaşsa kalem adı ve tutarı yazılmaz (CNL-05)", () => {
    const b = nakitEksiBildirimi(tahmin({ tarih: "2026-11-12", bakiye: -100 }, [kalem("2026-11-12", 80000, "bordro", "Kasım maaşı Ahmet Y.")]), "2026-11-12")!;
    expect(b.baslik).toContain("bugün");
    expect(b.aciklama).toContain("en büyüğü maaş ödemeleri");
    expect(b.aciklama).not.toContain("Ahmet");
  });
});
