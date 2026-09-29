import { describe, expect, it } from "vitest";
import { rotaEtiketi } from "./rota-etiketi";

describe("rotaEtiketi", () => {
  it("eşleşen rotanın kalıbını kullanır", () => {
    expect(rotaEtiketi({ route: { path: "/api/v1/belgeler/:id" }, baseUrl: "", path: "/api/v1/belgeler/595b55cc-2e0b-4f2b-90e0-b92335bba7f3" }))
      .toBe("/api/v1/belgeler/:id");
  });

  it("rota eşleşmediyse yoldaki kimlikleri maskeler", () => {
    expect(rotaEtiketi({ path: "/api/v1/belgeler/595b55cc-2e0b-4f2b-90e0-b92335bba7f3/pdf" })).toBe("/api/v1/belgeler/:id/pdf");
    expect(rotaEtiketi({ path: "/api/v1/cari/42/ekstre" })).toBe("/api/v1/cari/:id/ekstre");
    expect(rotaEtiketi({ path: "/api/v1/ebelge/TKF2026000015" })).toBe("/api/v1/ebelge/:id");
    expect(rotaEtiketi({ path: "/health" })).toBe("/health");
  });

  it("yol yoksa bilinmiyor der", () => {
    expect(rotaEtiketi({})).toBe("unknown");
  });
});
