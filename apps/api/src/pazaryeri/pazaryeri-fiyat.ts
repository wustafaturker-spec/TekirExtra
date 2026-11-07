import { Prisma } from "@prisma/client";
import { faturaHesapla } from "@tekirextra/shared";
import { icYuzdeMatrah } from "../fatura/kur-farki-kural";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const kurus = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export interface KdvDahilSatir {
  /** Satır kimliği (hata mesajı ve eşleme için). */
  stokId: string;
  miktar: Prisma.Decimal.Value;
  /** PZR-01: pazaryerinin birim fiyatı — KDV dahil, indirimler düşülmüş (müşterinin ödediği). */
  kdvDahilBirimFiyat: Prisma.Decimal.Value;
  kdvOrani: Prisma.Decimal.Value;
}

export interface NetSatir {
  stokId: string;
  miktar: string;
  /** Faturaya yazılacak KDV hariç birim fiyat (4 ondalık). */
  birimFiyat: string;
  kdvOrani: string;
  /** Satırın KDV dahil tutarı (müşterinin ödediği, kuruş). */
  kdvDahilTutar: string;
}

/**
 * PZR-01: KDV dahil satırı faturanın net birim fiyatına çevirir. Satırın KDV
 * dahil tutarından (miktar × birim fiyat, kuruşa yuvarlı) matrah iç yüzdeyle
 * ayrılır (`matrah + KDV` = KDV dahil tutar); net birim fiyat 4 ondalıkla,
 * `miktar × birim fiyat` kuruşta matraha eşit çıkacak biçimde aranır.
 */
export function kdvDahilSatiriNetle(s: KdvDahilSatir): NetSatir {
  const miktar = D(s.miktar);
  const dahil = kurus(miktar.mul(D(s.kdvDahilBirimFiyat)));
  const matrah = icYuzdeMatrah(dahil, s.kdvOrani);
  const tahmin = miktar.isZero() ? D(0) : matrah.div(miktar).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  let birimFiyat = tahmin;
  for (const adim of [0, 1, -1, 2, -2, 3, -3]) {
    const aday = tahmin.add(D(adim).div(10_000));
    if (aday.gte(0) && kurus(miktar.mul(aday)).eq(matrah)) { birimFiyat = aday; break; }
  }
  return { stokId: s.stokId, miktar: miktar.toString(), birimFiyat: birimFiyat.toFixed(4), kdvOrani: D(s.kdvOrani).toString(), kdvDahilTutar: dahil.toFixed(2) };
}

/**
 * PZR-01 tutar kilidi: net satırlarla faturanın kendi hesap motorunun bulacağı
 * genel toplam pazaryerinin sipariş toplamıyla karşılaştırılır. KDV satır başına
 * kuruşa yuvarlandığından bazı KDV dahil tutarlar (ör. %20'de 99,99) tek satırla
 * tam elde edilemez (%20'de tutarların ~%17'si); bu yüzden fark **satır başına en
 * çok 1 kuruşa** kadar kabul edilir (karar 2026-11-07) ve `fark` olarak döner.
 * Daha büyük farkta (alan yorumu yanlış, kargo/hediye paketi gibi satır dışı
 * tutar, eksik indirim) fatura oluşturulmaz.
 */
export function pazaryeriFaturaSatirlari(satirlar: KdvDahilSatir[], siparisToplami: Prisma.Decimal.Value): { satirlar: NetSatir[]; faturaToplami: string; fark: string } {
  const netler = satirlar.map(kdvDahilSatiriNetle);
  const hesap = faturaHesapla({ satirlar: netler.map((n) => ({ stokId: n.stokId, miktar: Number(n.miktar), birimFiyat: Number(n.birimFiyat), kdvOrani: Number(n.kdvOrani) })) });
  const faturaToplami = D(hesap.genelToplam).toFixed(2);
  const siparis = kurus(D(siparisToplami));
  if (siparis.lte(0)) throw new Error("Pazaryeri sipariş toplamını bildirmedi; fatura tutarı doğrulanamadığı için fatura oluşturulmadı");
  const fark = D(faturaToplami).sub(siparis);
  if (fark.abs().gt(D(satirlar.length).mul("0.01"))) {
    throw new Error(`Tutar uyuşmuyor: fatura toplamı ${faturaToplami}, pazaryeri sipariş toplamı ${siparis.toFixed(2)} (${satirlar.length} satır). Fatura oluşturulmadı; satır fiyatlarını ve sipariş dışı tutarları (kargo, hediye paketi) kontrol edin.`);
  }
  return { satirlar: netler, faturaToplami, fark: fark.toFixed(2) };
}
