import { describe, expect, it } from "vitest";
import { parcala, tcknGecerliMi, telegramSuz } from "./telegram-suzgec";

describe("Telegram çıktı süzgeci (CNL-05)", () => {
  const acik = { tutarGoster: true };

  it("tam IBAN'ı son dört haneye indirir; boşluklu yazımı da yakalar", () => {
    expect(telegramSuz("IBAN: TR330006100519786457841326", acik)).toBe("IBAN: TR** **** 1326 (tam IBAN panelde)");
    expect(telegramSuz("TR33 0006 1005 1978 6457 8413 26 hesabına", acik)).toBe("TR** **** 1326 (tam IBAN panelde) hesabına");
  });

  it("sağlaması tutan kimlik numarasını gizler, VKN'ye, telefona ve tutara dokunmaz", () => {
    expect(tcknGecerliMi("10000000146")).toBe(true);
    expect(tcknGecerliMi("10000000147")).toBe(false);
    expect(telegramSuz("TCKN 10000000146", acik)).toBe("TCKN *********** (kimlik no panelde)");
    expect(telegramSuz("VKN 1234567890, tel 05321234567, sağlamasız 12345678901", acik)).toBe("VKN 1234567890, tel 05321234567, sağlamasız 12345678901");
    expect(telegramSuz("Bakiye 10000000146,50 TL", acik)).toBe("Bakiye 10000000146,50 TL");
  });

  it("anahtar biçimlerini gizler", () => {
    expect(telegramSuz("anahtar tkx_abcdefgh12345678 ve 123456789:AAEhBP0av18Fz6Xx-abcdefghijklmnopqrs", acik)).toBe("anahtar [gizli anahtar] ve [gizli anahtar]");
  });

  it("tutar gizleme kapalıyken tutarlar kalır, açıkken para birimli tutarlar gizlenir", () => {
    const metin = "Nakit 1.250.000,50 TL; alacak ₺3.400 ve 120 USD. 12 fatura, 2026 yılı.";
    expect(telegramSuz(metin, acik)).toBe(metin);
    expect(telegramSuz(metin, { tutarGoster: false })).toBe("Nakit [tutar gizli]; alacak [tutar gizli] ve [tutar gizli]. 12 fatura, 2026 yılı.");
  });
});

describe("mesaj bölme", () => {
  it("sınırı aşmayan metni tek parça bırakır", () => {
    expect(parcala("merhaba")).toEqual(["merhaba"]);
  });

  it("uzun metni paragraf sınırından böler; hiçbir parça sınırı aşmaz", () => {
    const metin = Array.from({ length: 30 }, (_, i) => `Paragraf ${i} ${"x".repeat(300)}`).join("\n\n");
    const p = parcala(metin, 1000);
    expect(p.length).toBeGreaterThan(1);
    expect(p.every((x) => x.length <= 1000)).toBe(true);
    expect(p.join("\n\n")).toBe(metin);
  });

  it("boşluksuz uzun metni sert keser", () => {
    expect(parcala("a".repeat(2500), 1000).map((x) => x.length)).toEqual([1000, 1000, 500]);
  });
});
