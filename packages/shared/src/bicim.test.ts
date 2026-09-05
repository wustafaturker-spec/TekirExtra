import { describe, expect, it } from "vitest";
import {
  donemBicimle,
  metinEslesiyor,
  metinNormalize,
  miktarBicimle,
  paraBicimle,
  tarihBicimle,
  yuzdeBicimle,
} from "./bicim";

describe("paraBicimle", () => {
  it("Prisma'dan gelen string tutarı Türkçe biçimde yazar", () => {
    expect(paraBicimle("1234.5")).toBe("₺1.234,50");
  });

  it("özet kartları için basamak düşürebilir ve simgeyi gizleyebilir", () => {
    expect(paraBicimle(1234.56, { basamak: 0 })).toBe("₺1.235");
    expect(paraBicimle(1234.56, { simgesiz: true })).toBe("1.234,56");
  });

  it("dövizli tutarı kendi para birimiyle yazar", () => {
    expect(paraBicimle(100, { dovizCinsi: "USD" })).toBe("$100,00");
  });

  it("boş ve geçersiz değerleri sıfır göstermez", () => {
    expect(paraBicimle(null)).toBe("—");
    expect(paraBicimle("")).toBe("—");
    expect(paraBicimle("abc")).toBe("—");
    expect(paraBicimle(0)).toBe("₺0,00");
  });
});

describe("miktarBicimle", () => {
  it("gereksiz sıfır basamak yazmaz, birimi ekler", () => {
    expect(miktarBicimle(12)).toBe("12");
    expect(miktarBicimle("12.5000", "kg")).toBe("12,5 kg");
  });
});

describe("yuzdeBicimle", () => {
  it("işareti sayının önüne koyar", () => {
    expect(yuzdeBicimle(18)).toBe("%18");
    expect(yuzdeBicimle(18.5, 2)).toBe("%18,5");
  });
});

describe("tarihBicimle", () => {
  it("yalnız tarih taşıyan değeri UTC'de biçimler; gün kaymaz", () => {
    // Prisma @db.Date alanları bu biçimde gelir. Yerel saatte biçimlenirse
    // negatif ofsetli makinelerde 14.08.2026 görünürdü.
    expect(tarihBicimle("2026-08-15T00:00:00.000Z")).toBe("15.08.2026");
    expect(tarihBicimle("2026-08-15")).toBe("15.08.2026");
  });

  it("boş değeri tarihe çevirmeye çalışmaz", () => {
    expect(tarihBicimle(null)).toBe("—");
    expect(tarihBicimle("gecersiz")).toBe("—");
  });
});

describe("donemBicimle", () => {
  it("mali dönem başlığını ay adıyla yazar", () => {
    expect(donemBicimle(2026, 8)).toBe("Ağustos 2026");
    expect(donemBicimle(2026, 1)).toBe("Ocak 2026");
  });
});

describe("metinNormalize", () => {
  it("Türkçe küçültme kurallarını uygular", () => {
    // toLowerCase() burada "i̇stanbul" (birleşik işaretli) üretir.
    expect(metinNormalize("İSTANBUL")).toBe("istanbul");
    expect(metinNormalize("IŞIK")).toBe("isik");
  });

  it("aksansız arama şapkalı/noktalı kaydı bulur", () => {
    expect(metinEslesiyor("Şişli Ticaret A.Ş.", "sisli")).toBe(true);
    expect(metinEslesiyor("Çağrı Ünlü", "cagri unlu")).toBe(true);
    expect(metinEslesiyor("Ankara Lojistik", "izmir")).toBe(false);
  });
});
