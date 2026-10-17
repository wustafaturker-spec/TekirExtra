import { describe, expect, it } from "vitest";
import { pdfSayfaSayisi } from "./pdf.service";

describe("pdfSayfaSayisi", () => {
  it("sayfa nesnelerini sayar; /Pages kökünü ve benzer adları saymaz", () => {
    const pdf = Buffer.from("1 0 obj << /Type /Pages /Kids [2 0 R 3 0 R] >> 2 0 obj << /Type /Page >> 3 0 obj <</Type/Page/Parent 1 0 R>> 4 0 obj << /Type /PageLabel >>", "latin1");
    expect(pdfSayfaSayisi(pdf)).toBe(2);
  });
});
