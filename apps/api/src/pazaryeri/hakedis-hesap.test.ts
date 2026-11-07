import { describe, expect, it } from "vitest";
import { hakedisOnerisi } from "./hakedis-hesap";

const g = (gun: number) => new Date(Date.UTC(2026, 9, gun));

describe("hakediş önerisi (PZR-13)", () => {
  const siparisler = [{ id: "s1", tarih: g(1), tutar: "1000" }, { id: "s2", tarih: g(5), tutar: "500" }, { id: "s3", tarih: g(9), tutar: "800" }];
  const kesintiler = [{ id: "k1", tarih: g(2), tutar: "150" }, { id: "k2", tarih: g(6), tutar: "60" }, { id: "k3", tarih: g(10), tutar: "90" }];

  it("banka tutarına en yakın kesim tarihine kadarki kalemleri seçer", () => {
    // 6 Ekim kesimi: 1500 − 210 = 1290
    expect(hakedisOnerisi(siparisler, kesintiler, "1290")).toEqual({ siparisIds: ["s1", "s2"], kesintiIds: ["k1", "k2"], net: "1290.00", fark: "0.00" });
  });

  it("tam eşleşme yoksa farkı bildirir", () => {
    const r = hakedisOnerisi(siparisler, kesintiler, "2000");
    // 10 Ekim: 2300 − 300 = 2000 → tam; 2050 için 9 Ekim (2090) en yakın
    expect(r.fark).toBe("0.00");
    const r2 = hakedisOnerisi(siparisler, kesintiler, "2060");
    expect(r2).toMatchObject({ siparisIds: ["s1", "s2", "s3"], kesintiIds: ["k1", "k2"], net: "2090.00", fark: "30.00" });
  });

  it("eşitlikte daha geç kesim seçilir", () => {
    const r = hakedisOnerisi([{ id: "a", tarih: g(1), tutar: "100" }, { id: "b", tarih: g(2), tutar: "100" }], [], "150");
    expect(r.siparisIds).toEqual(["a", "b"]);
    expect(r.fark).toBe("50.00");
  });

  it("aday yoksa boş öneri ve banka tutarı kadar eksik", () => {
    expect(hakedisOnerisi([], [], "75.5")).toEqual({ siparisIds: [], kesintiIds: [], net: "0.00", fark: "-75.50" });
  });
});
