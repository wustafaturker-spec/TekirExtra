import { type InternetSatisEngeli, internetSatisEngelleri } from "@tekirextra/shared";
import { teslimatAdresiSec } from "./eirsaliye-engeller";
import type { InternetSatisUblBilgisi } from "./xml-uretec";

/**
 * İnternet satışı alanlarını tek yerde çözer (EBLG-56). Sihirbaz önizlemesi ile
 * gönderim aynı işlevi çağırır; malın gittiği adres e-İrsaliye'dekiyle aynı
 * kuralla seçilir (sevk adresi, yoksa merkez/fatura) — aynı satışın iki
 * belgesinde farklı adres görünmesin.
 */

export interface InternetSatisFaturaGirdisi {
  internetSatisi: boolean;
  internetWebAdresi: string | null;
  internetOdemeSekli: string | null;
  internetOdemeTarihi: Date | null;
  internetOdemeAracisi: string | null;
  internetTasiyiciUnvan: string | null;
  internetTasiyiciVkn: string | null;
  internetGonderiTarihi: Date | null;
  siparisNo: string | null;
  siparisTarihi: Date | null;
  cari: {
    adresler: { tip: string; adres: string | null; il: string | null; ilce: string | null; postaKodu: string | null; ulke: string | null }[];
  };
}

export interface InternetSatisOzeti {
  internetSatisi: boolean;
  /**
   * Kartta teslimata elverişli adres var mı. İşaret konmamış faturada da
   * hesaplanır: sihirbazda kutu işaretlenince eksik listesi bununla üretilir.
   */
  teslimatAdresiVar: boolean;
  engeller: InternetSatisEngeli[];
  ublBilgisi?: InternetSatisUblBilgisi;
}

export function internetSatisOzeti(fatura: InternetSatisFaturaGirdisi): InternetSatisOzeti {
  const teslimat = teslimatAdresiSec(fatura.cari.adresler);
  if (!fatura.internetSatisi) {
    return { internetSatisi: false, teslimatAdresiVar: Boolean(teslimat), engeller: [] };
  }

  const engeller = internetSatisEngelleri({
    internetSatisi: true,
    siparisNo: fatura.siparisNo,
    siparisTarihi: fatura.siparisTarihi,
    webAdresi: fatura.internetWebAdresi,
    odemeSekli: fatura.internetOdemeSekli,
    odemeTarihi: fatura.internetOdemeTarihi,
    tasiyiciVkn: fatura.internetTasiyiciVkn,
    teslimatAdresiVar: Boolean(teslimat),
  });

  return {
    internetSatisi: true,
    teslimatAdresiVar: Boolean(teslimat),
    engeller,
    ublBilgisi: {
      webAdresi: fatura.internetWebAdresi,
      odemeSekli: fatura.internetOdemeSekli,
      odemeTarihi: fatura.internetOdemeTarihi,
      odemeAracisi: fatura.internetOdemeAracisi,
      tasiyiciUnvan: fatura.internetTasiyiciUnvan,
      tasiyiciVkn: fatura.internetTasiyiciVkn,
      gonderiTarihi: fatura.internetGonderiTarihi,
      teslimatAdresi: teslimat ?? undefined,
    },
  };
}
