import { IyzicoAdapter, iyzicoTelefonuDuzenle } from "../pos/iyzico.adapter";

export type AbonelikSaglayiciKodu = "iyzico" | "paytr";
export type SaglayiciOrtami = "test" | "canli";

export const SAGLAYICI_ADI: Record<AbonelikSaglayiciKodu, string> = { iyzico: "iyzico", paytr: "PayTR" };

/**
 * PLT-11: sağlayıcı başına alanlar. `gizli` alanlar bir kez girilir, sonra
 * gösterilmez; düzenlemede boş bırakılırsa kayıtlı değer korunur (EBLG-01b ile aynı kural).
 */
export const SAGLAYICI_ALANLARI: Record<AbonelikSaglayiciKodu, { anahtar: string; etiket: string; gizli: boolean }[]> = {
  iyzico: [
    { anahtar: "apiKey", etiket: "API anahtarı", gizli: true },
    { anahtar: "secretKey", etiket: "Gizli anahtar", gizli: true },
  ],
  paytr: [
    { anahtar: "magazaId", etiket: "Mağaza no", gizli: false },
    { anahtar: "merchantKey", etiket: "Mağaza parolası (merchant key)", gizli: true },
    { anahtar: "merchantSalt", etiket: "Mağaza gizli anahtarı (merchant salt)", gizli: true },
  ],
};

/** Adım 1'de bağlı sağlayıcılar; PayTR'ın ayarı kaydedilebilir ama etkinleştirilemez. */
export const BAGLI_SAGLAYICILAR: readonly AbonelikSaglayiciKodu[] = ["iyzico"];

export interface EtkinSaglayici {
  saglayici: AbonelikSaglayiciKodu;
  ortam: SaglayiciOrtami;
  config: Record<string, string>;
}

export interface OdemeAlicisi {
  ad: string;
  soyad: string;
  eposta: string;
  telefon?: string | null;
  kimlikNo: string;
  adres: string;
  il: string;
  ip?: string;
}

export interface OdemeBaslatGirdisi {
  denemeId: string;
  aciklama: string;
  toplam: number;
  firmaUnvani: string;
  alici: OdemeAlicisi;
  callbackUrl: string;
}

export interface OdemeSonucu {
  basarili: boolean;
  odemeId?: string;
  tutar: number;
  dovizCinsi: string;
}

/** Abonelik tahsilatının sağlayıcıdan bağımsız arayüzü; firma POS'undaki adaptörler yeniden kullanılır. */
export interface AbonelikOdemeSaglayicisi {
  odemeBaslat(girdi: OdemeBaslatGirdisi): Promise<{ token: string; odemeSayfasiUrl: string }>;
  odemeSonucu(token: string): Promise<OdemeSonucu>;
}

const IYZICO_ADRESI: Record<SaglayiciOrtami, string> = { test: "https://sandbox-api.iyzipay.com", canli: "https://api.iyzipay.com" };

export class IyzicoAbonelikSaglayicisi implements AbonelikOdemeSaglayicisi {
  constructor(
    private readonly ayar: EtkinSaglayici,
    private readonly adapter = new IyzicoAdapter(),
  ) {}

  private get config() {
    return { apiKey: this.ayar.config.apiKey, secretKey: this.ayar.config.secretKey, baseUrl: IYZICO_ADRESI[this.ayar.ortam] };
  }

  odemeBaslat(g: OdemeBaslatGirdisi) {
    const adres = { contactName: g.firmaUnvani, address: g.alici.adres, city: g.alici.il, country: "Türkiye" };
    return this.adapter.odemeBaslat(this.config, {
      locale: "tr",
      conversationId: g.denemeId,
      price: g.toplam,
      paidPrice: g.toplam,
      currency: "TRY",
      basketId: g.denemeId,
      paymentGroup: "SUBSCRIPTION",
      enabledInstallments: [1],
      callbackUrl: g.callbackUrl,
      buyer: {
        id: g.denemeId,
        name: g.alici.ad,
        surname: g.alici.soyad,
        identityNumber: g.alici.kimlikNo,
        email: g.alici.eposta,
        gsmNumber: iyzicoTelefonuDuzenle(g.alici.telefon),
        registrationAddress: g.alici.adres,
        city: g.alici.il,
        country: "Türkiye",
        ip: g.alici.ip,
      },
      billingAddress: adres,
      basketItems: [{ id: g.denemeId, name: g.aciklama, category1: "Abonelik", itemType: "VIRTUAL", price: g.toplam }],
    });
  }

  odemeSonucu(token: string) {
    return this.adapter.odemeSonucu(this.config, token);
  }
}

export function saglayiciKur(ayar: EtkinSaglayici): AbonelikOdemeSaglayicisi {
  if (ayar.saglayici === "iyzico") return new IyzicoAbonelikSaglayicisi(ayar);
  throw new Error(`${SAGLAYICI_ADI[ayar.saglayici]} abonelik tahsilatı henüz bağlı değil`);
}
