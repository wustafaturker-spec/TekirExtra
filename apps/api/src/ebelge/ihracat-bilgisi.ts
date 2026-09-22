import {
  type IhracatEngeli,
  type IhracatSatirGirdi,
  aliciUlkeKodu,
  ihracatEngelleri,
  menseiUyarilari,
  ulkeAdi,
  yurtDisiAliciMi,
  yurtDisiEarsivEngelleri,
  yurtDisiSatisTuru,
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
    vknTckn?: string | null;
    adresler: { tip: string; ulke: string | null; adres: string | null; il: string | null; ilce: string | null; postaKodu: string | null }[];
  };
  satirlar: {
    kdvOrani: unknown;
    stok: { ad: string; tip?: string | null; gtipKodu?: string | null; mensei?: string | null };
  }[];
}

export interface IhracatOzeti {
  /** Alıcı yurt dışı (EBLG-80); yurt içi kuralları (VKN, KAMU, iade…) kapanır. */
  yurtDisi: boolean;
  /** Belge ihracat e-Faturası olarak kesilir (mal, firma e-Fatura kullanıyor). */
  ihracat: boolean;
  /** Belge e-Arşiv ISTISNA olarak kesilir: hizmet satışı ya da e-Fatura kullanmayan firma. */
  yurtDisiEarsiv: boolean;
  ulkeKodu?: string;
  ulkeAdi?: string;
  engeller: IhracatEngeli[];
  menseiEksikleri: { sira: number; stokAdi: string; mensei: string }[];
  /** UBL üreticisine verilecek bilgi; yalnız ihracat faturasında doludur. */
  ublBilgisi?: IhracatUblBilgisi;
}

/**
 * `efaturaAcik`: firma e-Fatura kullanıyor mu (EBLG-77). Bilinmiyorsa ihracat
 * yolu varsayılır; kanal kararı zaten firma durumu bilinmeden belge göndermez.
 */
export function ihracatOzeti(fatura: IhracatFaturaGirdisi, secenek: { efaturaAcik?: boolean | null } = {}): IhracatOzeti {
  const ulkeKodu = aliciUlkeKodu(fatura.cari.adresler);
  if (!yurtDisiAliciMi({ ulkeKodu, vknTckn: fatura.cari.vknTckn })) return IHRACAT_DEGIL;

  const satirlar: IhracatSatirGirdi[] = fatura.satirlar.map((satir, index) => ({
    sira: index + 1,
    stokAdi: satir.stok.ad,
    stokTipi: satir.stok.tip,
    gtipKodu: satir.stok.gtipKodu,
    mensei: satir.stok.mensei,
    kdvOrani: Number(satir.kdvOrani),
  }));

  // EBLG-80: hizmet satırı olan fatura ya da e-Fatura kullanmayan firma
  // ihracat e-Faturası kesemez; belge e-Arşiv ISTISNA (301/302) olur.
  if (yurtDisiSatisTuru({ efaturaAcik: secenek.efaturaAcik !== false, stokTipleri: satirlar.map((s) => s.stokTipi) }) === "earsiv_istisna") {
    return {
      yurtDisi: true,
      ihracat: false,
      yurtDisiEarsiv: true,
      ulkeKodu,
      ulkeAdi: ulkeKodu ? ulkeAdi(ulkeKodu) : undefined,
      engeller: yurtDisiEarsivEngelleri(ulkeKodu, satirlar),
      menseiEksikleri: [],
    };
  }

  const bilgi = {
    teslimTarihi: fatura.ihracatTeslimTarihi,
    teslimSarti: fatura.ihracatTeslimSarti,
    tasimaSekli: fatura.ihracatTasimaSekli,
  };

  return {
    yurtDisi: true,
    ihracat: true,
    yurtDisiEarsiv: false,
    ulkeKodu,
    ulkeAdi: ulkeKodu ? ulkeAdi(ulkeKodu) : undefined,
    engeller: ihracatEngelleri(ulkeKodu, bilgi, satirlar),
    menseiEksikleri: menseiUyarilari(satirlar),
    ublBilgisi: {
      // Adres UBL üreticisinin kendisi tarafından karttan okunur (EBLG-55);
      // burada yalnız ihracata özgü alanlar taşınır.
      ulkeKodu: ulkeKodu ?? "",
      teslimTarihi: fatura.ihracatTeslimTarihi,
      teslimSarti: fatura.ihracatTeslimSarti,
      tasimaSekli: fatura.ihracatTasimaSekli,
      beyannameNo: fatura.gumrukBeyannameNo,
    },
  };
}

/** Yurt içi alıcı: hiçbir yurt dışı kuralı çalışmaz. */
export const IHRACAT_DEGIL: IhracatOzeti = { yurtDisi: false, ihracat: false, yurtDisiEarsiv: false, engeller: [], menseiEksikleri: [] };
