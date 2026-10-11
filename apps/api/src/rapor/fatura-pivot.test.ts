import { describe, expect, it } from "vitest";
import { pivotSorgusuCoz } from "./fatura-pivot";

describe("fatura pivot sorgusu (RPR-14)", () => {
  it("varsayılan: satış, yalnız kesin, cari × ay", () => {
    expect(pivotSorgusuCoz({ baslangic: "2026-01-01", bitis: "2026-10-11" })).toMatchObject({ yon: "satis", durum: "kesin", satir: "cari", sutun: "ay" });
  });

  it("dönem zorunlu, ters ve iki yıldan uzun dönem reddedilir", () => {
    expect(() => pivotSorgusuCoz({})).toThrow();
    expect(() => pivotSorgusuCoz({ baslangic: "2026-10-11", bitis: "2026-01-01" })).toThrow();
    expect(() => pivotSorgusuCoz({ baslangic: "2023-01-01", bitis: "2026-01-01" })).toThrow();
  });

  it("bilinmeyen boyut ve durum varsayılana düşer; iptal seçilemez", () => {
    const q = pivotSorgusuCoz({ baslangic: "2026-01-01", bitis: "2026-01-31", satir: "f.id; DROP", durum: "iptal", yon: "x" });
    expect(q).toMatchObject({ satir: "cari", durum: "kesin", yon: "satis" });
  });

  it("satır ve sütun aynı boyut olamaz", () => {
    expect(pivotSorgusuCoz({ baslangic: "2026-01-01", bitis: "2026-01-31", satir: "urun", sutun: "urun" }).sutun).toBe("ay");
    expect(pivotSorgusuCoz({ baslangic: "2026-01-01", bitis: "2026-01-31", satir: "ay", sutun: "ay" }).sutun).toBe("tip");
  });
});
