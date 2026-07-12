/**
 * Parasal tutarlar uygulama genelinde kuruş cinsinden tam sayı taşınır;
 * veritabanında NUMERIC olarak saklanır (NFR-10). Kayan nokta ile para
 * hesabı yapılmaz.
 *
 * Not: Bu dosya fatura hesaplama motorunun çekirdeğidir; iskonto/tevkifat
 * dahil tam kural seti 4. aşamada (fatura modülü) genişletilecektir.
 */
export type Kurus = number;

function tamSayiKontrol(deger: number, ad: string): void {
  if (!Number.isSafeInteger(deger)) {
    throw new RangeError(`${ad} kuruş cinsinden güvenli bir tam sayı olmalıdır: ${deger}`);
  }
}

/** Yarıdan yukarı (half-up) yuvarlama — mevzuattaki kuruş yuvarlaması. */
export function yuvarla(deger: number): Kurus {
  return Math.round(deger);
}

/** Satır brüt tutarı: miktar × birim fiyat, iskonto oranı düşülmüş. */
export function satirTutari(
  miktar: number,
  birimFiyatKurus: Kurus,
  iskontoOrani = 0,
): Kurus {
  tamSayiKontrol(birimFiyatKurus, "birimFiyat");
  if (iskontoOrani < 0 || iskontoOrani > 100) {
    throw new RangeError(`İskonto oranı 0-100 aralığında olmalıdır: ${iskontoOrani}`);
  }
  return yuvarla(miktar * birimFiyatKurus * (1 - iskontoOrani / 100));
}

/** KDV tutarı: matrah × oran. */
export function kdvTutari(matrahKurus: Kurus, kdvOrani: number): Kurus {
  tamSayiKontrol(matrahKurus, "matrah");
  return yuvarla((matrahKurus * kdvOrani) / 100);
}

/** Kuruş → "1.234,56" biçiminde TL metni. */
export function kurusToTL(kurus: Kurus): string {
  tamSayiKontrol(kurus, "kurus");
  return (kurus / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
