import { describe, expect, it } from "vitest";
import { muhtelifMusteriMi } from "./muhtelif-musteri";

describe("muhtelifMusteriMi (EBLG-95)", () => {
  it("GİB'in muhtelif müşteri kimliğini tanır", () => {
    expect(muhtelifMusteriMi({ vknTckn: "5555555555" })).toBe(true);
    expect(muhtelifMusteriMi({ vknTckn: " 5555555555 " })).toBe(true);
  });

  it("başka kimliği ve kimliksiz cariyi muhtelif saymaz", () => {
    expect(muhtelifMusteriMi({ vknTckn: "2222222222" })).toBe(false);
    expect(muhtelifMusteriMi({ vknTckn: null })).toBe(false);
    expect(muhtelifMusteriMi(undefined)).toBe(false);
  });
});
