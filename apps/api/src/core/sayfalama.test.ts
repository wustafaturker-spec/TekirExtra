import { describe, expect, it } from "vitest";
import { sayfaAdedi } from "./sayfalama";

describe("sayfaAdedi", () => {
  it.each([
    [undefined, 50],
    ["", 50],
    ["abc", 50],
    ["-5", 1],
    ["0", 1],
    ["12.9", 12],
    ["5000", 200],
  ])("%s girdisini %i olarak sınırlar", (girdi, beklenen) => {
    expect(sayfaAdedi(girdi)).toBe(beklenen);
  });
});
