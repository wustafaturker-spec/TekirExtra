import {
  type IhracatEngeli,
  type IhracatSatirGirdi,
  aliciUlkeKodu,
  ihracatEngelleri,
  menseiUyarilari,
  ulkeAdi,
  yurtDisiMi,
} from "@tekirextra/shared";
import type { IhracatUblBilgisi } from "./xml-uretec";

/**
 * Faturanın ihracat faturası olup olmadığını ve belgeye gidecek gümrük
 * alanlarını tek yerde çözer (EBLG-53). Sihirbaz önizlemesi ile gönderim aynı
 * işlevi çağırır; iki taraf "bu belge ihracat mı" sorusunu ayrı yanıtlarsa
 * sihirbazda yurt içi görünen fatura ihracat olarak gidebilirdi.
 */

export interface IhracatFaturaGirdisi {
  ihracatTeslimTarihi: Date | null;
  ihracatTeslimSarti: string | null;
  ihracatTasimaSekli: string | null;
  gumrukBeyannameNo: string | null;
  cari: {
    adresler: { tip: string; ulke: string | null; adres: string | null; il: string | null; ilce: string | null; postaKodu: string | null }[];
  };
  satirlar: {
    kdvOrani: unknown;
    stok: { ad: string; tip?: string | null; gtipKodu?: string | null; mensei?: string | null };
  }[];
}

export interface IhracatOzeti {
  ihracat: boolean;
  ulkeKodu?: string;
  ulkeAdi?: string;
  engeller: IhracatEngeli[];
  menseiEksikleri: { sira: number; stokAdi: string; mensei: string }[];
  /** UBL üreticisine verilecek bilgi; yalnız ihracat faturasında doludur. */
  ublBilgisi?: IhracatUblBilgisi;
}

const ADRES_SIRASI = ["fatura", "merkez", "sube", "sevk", "depo"];

export function ihracatOzeti(fatura: IhracatFaturaGirdisi): IhracatOzeti {
  const ulkeKodu = aliciUlkeKodu(fatura.cari.adresler);
  if (!yurtDisiMi(ulkeKodu)) return { ihracat: false, engeller: [], menseiEksikleri: [] };

  const satirlar: IhracatSatirGirdi[] = fatura.satirlar.map((satir, index) => ({
    sira: index + 1,
    stokAdi: satir.stok.ad,
    stokTipi: satir.stok.tip,
    gtipKodu: satir.stok.gtipKodu,
    mensei: satir.stok.mensei,
    kdvOrani: Number(satir.kdvOrani),
  }));

  const bilgi = {
    teslimTarihi: fatura.ihracatTeslimTarihi,
    teslimSarti: fatura.ihracatTeslimSarti,
    tasimaSekli: fatura.ihracatTasimaSekli,
  };
  const adres = [...fatura.cari.adresler].sort(
    (a, b) => ADRES_SIRASI.indexOf(a.tip) - ADRES_SIRASI.indexOf(b.tip),
  )[0];

  return {
    ihracat: true,
    ulkeKodu,
    ulkeAdi: ulkeAdi(ulkeKodu),
    engeller: ihracatEngelleri(ulkeKodu, bilgi, satirlar),
    menseiEksikleri: menseiUyarilari(satirlar),
    ublBilgisi: {
      ulkeKodu: ulkeKodu!,
      adres: adres ? { adres: adres.adres, il: adres.il, ilce: adres.ilce, postaKodu: adres.postaKodu } : undefined,
      teslimTarihi: fatura.ihracatTeslimTarihi,
      teslimSarti: fatura.ihracatTeslimSarti,
      tasimaSekli: fatura.ihracatTasimaSekli,
      beyannameNo: fatura.gumrukBeyannameNo,
    },
  };
}
