import { describe, expect, it } from "vitest";
import { gelirKategoriGuncelleSemasi, gelirKaydiOlusturSemasi } from "./gelirler.semalar";

const temel = {
  kategoriId: "550e8400-e29b-41d4-a716-446655440000",
  tarih: "2026-09-13",
  brutTutar: "1000",
  netTutar: "1000",
  kasaId: "550e8400-e29b-41d4-a716-446655440001",
} as const;

describe("gelir şemaları", () => {
  it("TL gelirde kuru 1 kabul eder", () => {
    const sonuc = gelirKaydiOlusturSemasi.safeParse(temel);
    expect(sonuc.success && sonuc.data.kur).toBe("1");
  });

  it("dövizli gelirde kur 1 kabul etmez (GLR-03)", () => {
    const doviz = { ...temel, dovizCinsi: "USD" };
    expect(gelirKaydiOlusturSemasi.safeParse(doviz).success).toBe(false);
    expect(gelirKaydiOlusturSemasi.safeParse({ ...doviz, kur: "1" }).success).toBe(false);
    const kurlu = gelirKaydiOlusturSemasi.safeParse({ ...doviz, kur: "41.25" });
    expect(kurlu.success && kurlu.data.kur).toBe("41.25");
  });

  it("kasa veya banka hesabı olmadan reddeder", () => {
    const { kasaId: _kasaId, ...hesapsiz } = temel;
    expect(gelirKaydiOlusturSemasi.safeParse(hesapsiz).success).toBe(false);
  });

  it("kategori güncellemesinde gönderilmeyen varsayılan KDV'yi değiştirmez (GLR-04)", () => {
    const sonuc = gelirKategoriGuncelleSemasi.safeParse({ ad: "Kira Gelirleri", varsayilanStopajOrani: "20" });
    expect(sonuc.success).toBe(true);
    expect(sonuc.success && "varsayilanKdvOrani" in sonuc.data).toBe(false);
  });
});
