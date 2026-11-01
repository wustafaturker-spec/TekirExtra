import { describe, expect, it } from "vitest";
import { trustProxyDegeri } from "./proxy-guveni";

describe("SEC-06 TRUST_PROXY", () => {
  it("boş ise ayarlanmaz; sayı, false ve adres listesi olduğu gibi geçer", () => {
    expect(trustProxyDegeri(undefined)).toBeUndefined();
    expect(trustProxyDegeri(" ")).toBeUndefined();
    expect(trustProxyDegeri("1", "production")).toBe(1);
    expect(trustProxyDegeri("false", "production")).toBe(false);
    expect(trustProxyDegeri("loopback", "production")).toBe("loopback");
    expect(trustProxyDegeri("loopback, 10.0.0.0/8", "production")).toBe("loopback, 10.0.0.0/8");
  });
  it("'true' üretimde reddedilir, geliştirmede kabul edilir", () => {
    expect(() => trustProxyDegeri("true", "production")).toThrow(/üretimde kullanılamaz/);
    expect(trustProxyDegeri("true", "development")).toBe(true);
  });
});
