import { describe, expect, it } from "vitest";
import { fiyatListesiSurumu } from "./fiyat-listesi-surumu";
import { fiyatListesiTopluSemasi } from "./fiyat-listeleri.semalar";
import { kuralSemasi } from "../onay/onay-kurallari";

describe("fiyat listesi onay sürümü", () => {
  const liste = { ad: "Bayi", dovizCinsi: "TRY", aktif: true, kalemler: [{ stokId: "b", fiyat: "100" }, { stokId: "a", fiyat: "20" }] };
  it("sıra bağımsızdır; fiyat, para birimi veya etkinlik değişince eski onayı kullanmaz", () => {
    const s = fiyatListesiSurumu(liste);
    expect(fiyatListesiSurumu({ ...liste, kalemler: [...liste.kalemler].reverse() })).toBe(s);
    expect(fiyatListesiSurumu({ ...liste, aktif: false })).not.toBe(s);
    expect(fiyatListesiSurumu({ ...liste, dovizCinsi: "USD" })).not.toBe(s);
    expect(fiyatListesiSurumu({ ...liste, kalemler: [{ stokId: "a", fiyat: "21" }] })).not.toBe(s);
  });
  it("fiyat işlemi ONY kuralıdır; anlamsız iskonto koşulu ve boş toplu yazım reddedilir", () => {
    expect(kuralSemasi.safeParse({ islem: "fiyat_listesi_guncelle", ad: "Fiyat", adimlar: [{ rol: "yonetici" }] }).success).toBe(true);
    expect(kuralSemasi.safeParse({ islem: "fiyat_listesi_guncelle", ad: "Fiyat", iskontoEsigi: 10, adimlar: [{ rol: "yonetici" }] }).success).toBe(false);
    expect(fiyatListesiTopluSemasi.safeParse({ surum: fiyatListesiSurumu(liste), kalemler: [] }).success).toBe(false);
  });
});
