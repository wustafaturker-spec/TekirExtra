import { describe, expect, it } from "vitest";
import { resmiTatiller } from "./resmi-tatiller";

describe("resmiTatiller", () => {
  it("sabit günleri her yıl, arifeleri yarım gün verir", () => {
    const liste = resmiTatiller(2030);
    expect(liste.map((t) => t.tarih)).toEqual(["2030-01-01", "2030-04-23", "2030-05-01", "2030-05-19", "2030-07-15", "2030-08-30", "2030-10-28", "2030-10-29"]);
    expect(liste.find((t) => t.tarih === "2030-10-28")?.yarimGun).toBe(true);
  });

  it("2027 bayramlarını ekler; 19 Mayıs ile Kurban 4. günü tek tam gün olur", () => {
    const liste = resmiTatiller(2027);
    expect(liste.find((t) => t.tarih === "2027-03-08")).toEqual({ tarih: "2027-03-08", ad: "Ramazan Bayramı arifesi", yarimGun: true });
    expect(liste.filter((t) => t.ad.startsWith("Kurban Bayramı")).map((t) => t.tarih)).toEqual(["2027-05-15", "2027-05-16", "2027-05-17", "2027-05-18"]);
    const ondokuz = liste.filter((t) => t.tarih === "2027-05-19");
    expect(ondokuz).toHaveLength(1);
    expect(ondokuz[0]).toMatchObject({ yarimGun: false, ad: expect.stringContaining("Kurban Bayramı 4. gün") });
  });
});
