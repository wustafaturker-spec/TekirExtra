/**
 * Belgeye yazılacak adresin seçimi ve UBL karşılığı (EBLG-55).
 *
 * Cari kartında birden çok adres olabilir; belgede bunlardan biri görünür.
 * Sıra fatura → merkez → şube → sevk → depo'dur: faturanın muhatabı fatura
 * adresidir, yoksa firmanın merkezi. Seçimi tek yerde tutarız ki fatura,
 * irsaliye ve ihracat kanalı kararı aynı adresi görsün — biri fatura adresine,
 * öteki ilk kayda bakarsa aynı cari bir belgede yurt içi, ötekinde yurt dışı
 * olurdu.
 */

import { ulkeAdi, ulkeKoduCoz } from "./ulke";

export const ADRES_ONCELIGI = ["fatura", "merkez", "sube", "sevk", "depo"];

export interface BelgeAdresGirdi {
  tip: string;
  adres?: string | null;
  il?: string | null;
  ilce?: string | null;
  postaKodu?: string | null;
  ulke?: string | null;
}

export interface UblAdresi {
  adres?: string;
  /** UBL-TR `CitySubdivisionName`; boş bırakılamaz. */
  ilce: string;
  /** UBL-TR `CityName`; boş bırakılamaz. */
  il: string;
  postaKodu?: string;
  ulkeKodu: string;
  ulkeAdi?: string;
  /** Kartta hiç adres yok mu — ekranlar bunu uyarı olarak gösterir. */
  eksik: boolean;
}

/** Kayıtlı adresler arasından belgeye gidecek olanı seçer. */
export function belgeAdresiSec<T extends BelgeAdresGirdi>(adresler: readonly T[] | null | undefined): T | undefined {
  if (!adresler?.length) return undefined;
  return [...adresler].sort((a, b) => sira(a.tip) - sira(b.tip))[0];
}

const sira = (tip: string) => {
  const yer = ADRES_ONCELIGI.indexOf(tip);
  return yer === -1 ? ADRES_ONCELIGI.length : yer;
};

/**
 * Adresi UBL'e yazılacak hâle getirir. Kartta adres yoksa zorunlu alanlar
 * "-" gider: belgeye uydurma bir şehir yazmaktansa boş bırakıldığı görünsün.
 */
export function ublAdresi(adresler: readonly BelgeAdresGirdi[] | null | undefined): UblAdresi {
  const secilen = belgeAdresiSec(adresler);
  const ulkeKodu = ulkeKoduCoz(secilen?.ulke) ?? "TR";
  return {
    adres: secilen?.adres?.trim() || undefined,
    ilce: secilen?.ilce?.trim() || "-",
    il: secilen?.il?.trim() || "-",
    postaKodu: secilen?.postaKodu?.trim() || undefined,
    ulkeKodu,
    ulkeAdi: ulkeAdi(ulkeKodu),
    eksik: !secilen,
  };
}
