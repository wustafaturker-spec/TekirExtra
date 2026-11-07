import { describe, expect, it } from "vitest";
import { faturaNoMetni } from "./fatura-no";

describe("faturaNoMetni", () => {
  it("numara varsa numara, taslak 'Taslak', kesin/iptal numarasız 'Gönderilmedi'", () => {
    expect(faturaNoMetni("SNC2026000000049", "kesin", true)).toBe("SNC2026000000049");
    expect(faturaNoMetni(null, "taslak", true)).toBe("(Taslak)");
    expect(faturaNoMetni(null, "kesin", true)).toBe("(Gönderilmedi)");
    expect(faturaNoMetni(null, "iptal")).toBe("Gönderilmedi");
    expect(faturaNoMetni("", undefined)).toBe("Taslak");
    expect(faturaNoMetni(null, "iptal", true, "alis")).toBe("(Numarasız)");
    expect(faturaNoMetni(null, "taslak", true, "alis")).toBe("(Taslak)");
    expect(faturaNoMetni(null, "kesin", false, "alis_iade")).toBe("Gönderilmedi");
  });
});
