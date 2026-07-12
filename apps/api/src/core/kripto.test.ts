import { beforeEach, describe, expect, it } from "vitest";
import { coz, sifrele } from "./kripto";

describe("kripto (AES-256-GCM)", () => {
  beforeEach(() => {
    process.env.BAGLANTI_SIFRELEME_ANAHTARI = "ab".repeat(32);
  });

  it("şifreler ve çözer (roundtrip)", () => {
    const gizli = JSON.stringify({ kullaniciAdi: "firma", parola: "cok-gizli" });
    expect(coz(sifrele(gizli))).toBe(gizli);
  });

  it("her şifrelemede farklı çıktı üretir (rastgele IV)", () => {
    expect(sifrele("aynı")).not.toBe(sifrele("aynı"));
  });

  it("kurcalanan veriyi reddeder (GCM tag)", () => {
    const sifreli = Buffer.from(sifrele("veri"), "base64");
    sifreli[sifreli.length - 1] ^= 0xff;
    expect(() => coz(sifreli.toString("base64"))).toThrow();
  });

  it("geçersiz anahtar uzunluğunu reddeder", () => {
    process.env.BAGLANTI_SIFRELEME_ANAHTARI = "kisa";
    expect(() => sifrele("veri")).toThrow(/32 bayt/);
  });
});
