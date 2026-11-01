import { describe, expect, it } from "vitest";
import { metrikErisimi } from "./observability.controller";

describe("SEC-07 /metrics erişimi", () => {
  it("üretimde token yoksa uç kapalı; geliştirmede açık", () => {
    expect(metrikErisimi(undefined, undefined, "production")).toBe("yok");
    expect(metrikErisimi("  ", "Bearer x", "production")).toBe("yok");
    expect(metrikErisimi(undefined, undefined, "development")).toBe("izinli");
  });
  it("token tanımlıysa yalnız doğru Bearer geçer", () => {
    const t = "m".repeat(40);
    expect(metrikErisimi(t, `Bearer ${t}`, "production")).toBe("izinli");
    expect(metrikErisimi(t, `bearer ${t}`, "production")).toBe("izinli");
    expect(metrikErisimi(t, "Bearer yanlis", "production")).toBe("yetkisiz");
    expect(metrikErisimi(t, undefined, "production")).toBe("yetkisiz");
    expect(metrikErisimi(t, "Bearer ", "development")).toBe("yetkisiz");
  });
});
