/**
 * FTR-26: irsaliyenin sonradan faturaya bağlanması. Satış irsaliyesi satış
 * faturasına, alış irsaliyesi alış faturasına bağlanır; iade ve proforma
 * faturası irsaliye kapatmaz.
 */
export const IRSALIYE_FATURA_TIPI = { satis: "satis", alis: "alis" } as const;

export function irsaliyeFaturaTipiUyarMi(irsaliyeYonu: string, faturaTipi: string): boolean {
  return IRSALIYE_FATURA_TIPI[irsaliyeYonu as keyof typeof IRSALIYE_FATURA_TIPI] === faturaTipi;
}

export interface KarsilastirmaSatiri {
  stokId: string;
  varyantId?: string | null;
  /** Uyarı metninde görünen ad (stok kodu + adı). */
  ad: string;
  miktar: string | number;
  birim: string;
  /** Stok kartı tipi; hizmet satırları karşılaştırılmaz. */
  stokTipi?: string | null;
}

export type KarsilastirmaFarkTuru = "yalniz_irsaliyede" | "yalniz_faturada" | "miktar" | "birim";

export interface KarsilastirmaFarki {
  tur: KarsilastirmaFarkTuru;
  ad: string;
  mesaj: string;
}

/** Miktarlar 3 ondalıkla saklanır; bundan küçük fark yuvarlamadır. */
const MIKTAR_TOLERANSI = 0.0005;

const bicimle = (n: number) => Number(n.toFixed(3)).toLocaleString("tr-TR", { maximumFractionDigits: 3 });

interface Grup {
  ad: string;
  birimler: Set<string>;
  toplam: number;
}

function grupla(satirlar: KarsilastirmaSatiri[]): Map<string, Grup> {
  const gruplar = new Map<string, Grup>();
  for (const s of satirlar) {
    if (s.stokTipi === "hizmet") continue;
    const anahtar = `${s.stokId}|${s.varyantId ?? ""}`;
    const grup = gruplar.get(anahtar) ?? { ad: s.ad, birimler: new Set<string>(), toplam: 0 };
    grup.birimler.add(s.birim);
    grup.toplam += Number(s.miktar);
    gruplar.set(anahtar, grup);
  }
  return gruplar;
}

/**
 * Yumuşak karşılaştırma (FTR-26 madde 8): irsaliye(ler) ile fatura satırları
 * stok kartı + varyant bazında toplanır. Dönen farklar yalnız uyarıdır,
 * bağlamayı engellemez. Birimi farklı kalemin miktarı karşılaştırılmaz —
 * çevrim katsayısı olmadan "5 koli" ile "60 adet" kıyaslanamaz.
 */
export function irsaliyeFaturaFarklari(irsaliye: KarsilastirmaSatiri[], fatura: KarsilastirmaSatiri[]): KarsilastirmaFarki[] {
  const irs = grupla(irsaliye);
  const ftr = grupla(fatura);
  const farklar: KarsilastirmaFarki[] = [];
  for (const [anahtar, i] of irs) {
    const f = ftr.get(anahtar);
    if (!f) {
      farklar.push({ tur: "yalniz_irsaliyede", ad: i.ad, mesaj: `${i.ad}: irsaliyede ${bicimle(i.toplam)} ${[...i.birimler].join("/")} var, faturada yok` });
      continue;
    }
    const ayniBirim = i.birimler.size === 1 && f.birimler.size === 1 && [...i.birimler][0] === [...f.birimler][0];
    if (!ayniBirim) {
      farklar.push({ tur: "birim", ad: i.ad, mesaj: `${i.ad}: birimler farklı (irsaliye ${[...i.birimler].join("/")}, fatura ${[...f.birimler].join("/")}); miktar karşılaştırılamadı` });
      continue;
    }
    if (Math.abs(i.toplam - f.toplam) > MIKTAR_TOLERANSI) {
      const birim = [...i.birimler][0];
      farklar.push({ tur: "miktar", ad: i.ad, mesaj: `${i.ad}: irsaliyede ${bicimle(i.toplam)} ${birim}, faturada ${bicimle(f.toplam)} ${birim}` });
    }
  }
  for (const [anahtar, f] of ftr) {
    if (!irs.has(anahtar)) {
      farklar.push({ tur: "yalniz_faturada", ad: f.ad, mesaj: `${f.ad}: faturada ${bicimle(f.toplam)} ${[...f.birimler].join("/")} var, irsaliyede yok` });
    }
  }
  return farklar;
}
