import { describe, expect, it } from "vitest";
import { earsivIptalBaslangici, earsivIptalGecenGun } from "./earsiv-iptal-suresi";

const g = (iso: string) => new Date(iso);

describe("e-Arşiv iptal süresi başlangıcı", () => {
  it("fatura tarihi ile gönderim gününden sonraki", () => {
    expect(earsivIptalBaslangici(g("2026-10-01T00:00:00Z"), g("2026-10-05T09:00:00Z"))).toBe("2026-10-05");
    expect(earsivIptalBaslangici(g("2026-10-05T00:00:00Z"), g("2026-10-04T09:00:00Z"))).toBe("2026-10-05");
    expect(earsivIptalBaslangici(g("2026-10-05T00:00:00Z"), null)).toBe("2026-10-05");
  });
  it("gönderim günü Türkiye saatine göre (gece 23:30 UTC ertesi gündür)", () => {
    expect(earsivIptalBaslangici(g("2026-10-01T00:00:00Z"), g("2026-10-04T22:30:00Z"))).toBe("2026-10-05");
  });
  it("takvim günüyle sayılır; geriye tarihli faturada süre gönderimden işler", () => {
    expect(earsivIptalGecenGun(g("2026-10-01T00:00:00Z"), g("2026-10-05T09:00:00Z"), "2026-10-13")).toBe(8);
    expect(earsivIptalGecenGun(g("2026-10-01T00:00:00Z"), null, "2026-10-13")).toBe(12);
  });
});
