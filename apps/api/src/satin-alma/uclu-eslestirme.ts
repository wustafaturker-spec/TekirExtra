/**
 * Üçlü eşleştirme (SAT-11): alış faturası, mal kabul (irsaliye) ve sipariş
 * arasındaki miktar ve fiyat farkları.
 *
 * Miktar faturayla mal kabul arasında, fiyat faturayla sipariş arasında
 * karşılaştırılır. Tolerans yüzdesinin altındaki sapma fark sayılmaz; üstündeki
 * fark faturayı engellemez, Düzeltme Merkezi'ne düşer.
 */

/** Varsayılan tolerans (%); `satin_alma` modül ayarından değiştirilir. */
export const VARSAYILAN_TOLERANS_YUZDE = 1;

export interface EslestirmeSatiri {
  stokId: string;
  stokKod: string;
  miktar: number;
  birimFiyat: number;
}

export interface EslestirmeBelgesi {
  tur: "siparis" | "irsaliye";
  satirlar: {
    stokId: string;
    stokKod: string;
    miktar: number;
    birimFiyat: number;
    /** İrsaliye satırının türediği sipariş satırının fiyatı; yoksa kendi fiyatı. */
    siparisBirimFiyati?: number | null;
  }[];
}

export type FarkTuru = "miktar" | "fiyat" | "kaynaksiz";

export interface Fark {
  stokKod: string;
  tur: FarkTuru;
  faturaDeger: number;
  kaynakDeger: number;
  /** Sapma (%); kaynak sıfırsa hesaplanamaz ve null kalır. */
  sapmaYuzde: number | null;
}

const yuvarla = (deger: number) => Math.round(deger * 100) / 100;

/** Sapma yüzdesi; kaynak sıfırken oran tanımsızdır. */
function sapma(fatura: number, kaynak: number): number | null {
  if (kaynak === 0) return null;
  return yuvarla((Math.abs(fatura - kaynak) / Math.abs(kaynak)) * 100);
}

/**
 * Faturayı kaynak belgeleriyle karşılaştırır. Kaynak belge yoksa (elle girilen
 * alış faturası) eşleştirilecek bir şey de yoktur, boş liste döner.
 */
export function ucluEslestir(girdi: {
  faturaSatirlari: EslestirmeSatiri[];
  belgeler: EslestirmeBelgesi[];
  miktarToleransYuzde: number;
  fiyatToleransYuzde: number;
}): Fark[] {
  if (girdi.belgeler.length === 0) return [];

  // Aynı stok faturada da kaynakta da birden çok satırda olabilir; karşılaştırma
  // stok bazında toplam üzerinden yapılır. Fiyat için ilk kaynak satırın fiyatı
  // esastır: sipariş fiyatı kalem başına tektir.
  const faturaMiktar = new Map<string, number>();
  const faturaFiyat = new Map<string, number>();
  const kod = new Map<string, string>();
  for (const s of girdi.faturaSatirlari) {
    faturaMiktar.set(s.stokId, (faturaMiktar.get(s.stokId) ?? 0) + s.miktar);
    if (!faturaFiyat.has(s.stokId)) faturaFiyat.set(s.stokId, s.birimFiyat);
    kod.set(s.stokId, s.stokKod);
  }

  const kabulMiktar = new Map<string, number>();
  const siparisFiyat = new Map<string, number>();
  for (const belge of girdi.belgeler) {
    for (const s of belge.satirlar) {
      kabulMiktar.set(s.stokId, (kabulMiktar.get(s.stokId) ?? 0) + s.miktar);
      if (!siparisFiyat.has(s.stokId)) siparisFiyat.set(s.stokId, s.siparisBirimFiyati ?? s.birimFiyat);
      if (!kod.has(s.stokId)) kod.set(s.stokId, s.stokKod);
    }
  }

  const farklar: Fark[] = [];
  for (const [stokId, miktar] of faturaMiktar) {
    const stokKod = kod.get(stokId) ?? stokId;
    const kabul = kabulMiktar.get(stokId);
    // Faturada olup sipariş edilmemiş ya da teslim alınmamış kalem
    if (kabul === undefined) {
      farklar.push({ stokKod, tur: "kaynaksiz", faturaDeger: yuvarla(miktar), kaynakDeger: 0, sapmaYuzde: null });
      continue;
    }
    const miktarSapmasi = sapma(miktar, kabul);
    if (miktarSapmasi === null || miktarSapmasi > girdi.miktarToleransYuzde) {
      farklar.push({ stokKod, tur: "miktar", faturaDeger: yuvarla(miktar), kaynakDeger: yuvarla(kabul), sapmaYuzde: miktarSapmasi });
    }
    const fiyat = faturaFiyat.get(stokId) ?? 0;
    const beklenen = siparisFiyat.get(stokId) ?? 0;
    const fiyatSapmasi = sapma(fiyat, beklenen);
    if (fiyatSapmasi !== null && fiyatSapmasi > girdi.fiyatToleransYuzde) {
      farklar.push({ stokKod, tur: "fiyat", faturaDeger: yuvarla(fiyat), kaynakDeger: yuvarla(beklenen), sapmaYuzde: fiyatSapmasi });
    }
  }

  // Teslim alınıp faturalanmamış kalem de eşleşmezliktir: fatura kaynağını
  // tümüyle kapatmış sayılamaz.
  for (const [stokId, kabul] of kabulMiktar) {
    if (faturaMiktar.has(stokId) || kabul === 0) continue;
    farklar.push({ stokKod: kod.get(stokId) ?? stokId, tur: "miktar", faturaDeger: 0, kaynakDeger: yuvarla(kabul), sapmaYuzde: 100 });
  }
  return farklar;
}

/** Düzeltme kaydının açıklaması: farkları tek satırda özetler. */
export function farkAciklamasi(farklar: Fark[]): string {
  return farklar
    .map((f) => {
      if (f.tur === "kaynaksiz") return `${f.stokKod}: faturada ${f.faturaDeger} miktar var, siparişte/mal kabulde yok`;
      const alan = f.tur === "miktar" ? "miktar" : "birim fiyat";
      // Çekim ekini kaynak adına göre yazıyoruz: "mal kabulde" ama "siparişte".
      const kaynak = f.tur === "miktar" ? "mal kabulde" : "siparişte";
      const sapmaMetni = f.sapmaYuzde === null ? "" : ` (%${f.sapmaYuzde})`;
      return `${f.stokKod}: ${alan} faturada ${f.faturaDeger}, ${kaynak} ${f.kaynakDeger}${sapmaMetni}`;
    })
    .join("; ");
}
