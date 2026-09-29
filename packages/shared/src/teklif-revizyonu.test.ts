import { describe, expect, it } from "vitest";
import { belgeNoMetni, revizyonEngeli } from "./teklif-revizyonu";

describe("teklif revizyonu (FTR-34)", () => {
  it("numarayı sürümle yazar, ilk sürümde yalın bırakır", () => {
    expect(belgeNoMetni("TKF2026000012", 0)).toBe("TKF2026000012");
    expect(belgeNoMetni("TKF2026000012", 2)).toBe("TKF2026000012 Rev.2");
  });

  it("yalnız onaylı, dönüşmemiş teklife izin verir", () => {
    expect(revizyonEngeli({ tur: "teklif", durum: "onaylandi" })).toBeNull();
    expect(revizyonEngeli({ tur: "teklif", durum: "kapandi" })).toMatch(/Siparişe dönüşmüş/);
    expect(revizyonEngeli({ tur: "teklif", durum: "revize_edildi" })).toMatch(/daha yeni bir sürümü/);
    expect(revizyonEngeli({ tur: "teklif", durum: "taslak" })).toMatch(/doğrudan düzenlenir/);
    expect(revizyonEngeli({ tur: "teklif", durum: "iptal" })).toMatch(/İptal/);
    expect(revizyonEngeli({ tur: "siparis", durum: "onaylandi" })).toMatch(/Yalnız teklifler/);
  });
});
