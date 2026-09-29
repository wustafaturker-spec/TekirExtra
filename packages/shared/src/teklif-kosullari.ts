import { TESLIM_SARTLARI } from "./ihracat";

/**
 * FTR-33: teklif koşulları. Teklif ve siparişte girilir, zincir boyunca
 * taşınır. Vade günü faturada vade tarihine çevrilir; teslim şekli
 * Incoterms kodudur ve ihracat faturasının boş teslim şartını doldurur.
 */

export interface TeklifKosullari {
  odemeVadeGun?: number | null;
  teslimSuresi?: string | null;
  teslimSekli?: string | null;
}

export const EN_UZUN_VADE_GUN = 365;

export function teslimSekliGecerliMi(kod: string | null | undefined): boolean {
  return !kod || TESLIM_SARTLARI.some((t) => t.kod === kod);
}

/** Fatura tarihi (YYYY-MM-DD) + vade günü; gün yoksa null. Tarih UTC gündür. */
export function vadeTarihiHesapla(tarih: string, gun: number | null | undefined): string | null {
  if (gun == null) return null;
  const d = new Date(`${tarih.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + gun);
  return d.toISOString().slice(0, 10);
}

/** Birleşen belgelerde her koşul için ilk dolu değer (toplu faturalama). */
export function ilkKosullar(belgeler: TeklifKosullari[]): { odemeVadeGun: number | null; teslimSuresi: string | null; teslimSekli: string | null } {
  return {
    odemeVadeGun: belgeler.find((b) => b.odemeVadeGun != null)?.odemeVadeGun ?? null,
    teslimSuresi: belgeler.find((b) => b.teslimSuresi?.trim())?.teslimSuresi?.trim() ?? null,
    teslimSekli: belgeler.find((b) => b.teslimSekli)?.teslimSekli ?? null,
  };
}

/** Çıktı ve ekran satırları: "Ödeme: 30 gün vadeli" gibi; boş koşul yazılmaz. */
export function kosulSatirlari(k: TeklifKosullari): string[] {
  const satirlar: string[] = [];
  if (k.odemeVadeGun != null) satirlar.push(`Ödeme: ${k.odemeVadeGun === 0 ? "Peşin" : `${k.odemeVadeGun} gün vadeli`}`);
  if (k.teslimSuresi?.trim()) satirlar.push(`Teslim süresi: ${k.teslimSuresi.trim()}`);
  if (k.teslimSekli) satirlar.push(`Teslim şekli: ${TESLIM_SARTLARI.find((t) => t.kod === k.teslimSekli)?.ad ?? k.teslimSekli}`);
  return satirlar;
}
