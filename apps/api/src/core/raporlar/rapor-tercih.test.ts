import { describe, expect, it } from "vitest";
import { sonListesi } from "./raporlar.service";
describe("son kullanılanlar (RPR-28)", () => {
  it("kod öne alınır, tekrar yok, en çok 5", () => {
    expect(sonListesi(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(sonListesi(["a", "b", "c", "d", "e"], "f")).toEqual(["f", "a", "b", "c", "d"]);
  });
});
