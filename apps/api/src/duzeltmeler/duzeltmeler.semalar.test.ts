import { describe, expect, it } from "vitest";
import { duzeltmeDurumSemasi } from "./duzeltmeler.semalar";

describe("duzeltmeDurumSemasi", () => {
  it("kullanıcının kaydı doğrudan çözüldü durumuna getirmesini reddeder", () => {
    expect(duzeltmeDurumSemasi.safeParse({ durum: "cozuldu" }).success).toBe(false);
    expect(duzeltmeDurumSemasi.safeParse({ durum: "incelemede" }).success).toBe(true);
    expect(duzeltmeDurumSemasi.safeParse({ durum: "beklemede" }).success).toBe(true);
    expect(duzeltmeDurumSemasi.safeParse({ durum: "yoksayildi" }).success).toBe(true);
  });
});
