import { randomBytes } from "node:crypto";
import { IyzicoAdapter, iyzicoTelefonuDuzenle } from "../pos/iyzico.adapter";
import { merchantOid, PaytrDirektAdapter, paytrFormAlanlari, type PaytrDirektConfig, type PaytrOdemeGirdisi } from "./paytr-direkt";

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

export const BAGLI_SAGLAYICILAR: readonly AbonelikSaglayiciKodu[] = ["iyzico", "paytr"];

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

export interface OdemeGirdisi {
  tenantId: string;
  denemeId: string;
  aciklama: string;
  /** KDV dahil, "478.80" */
  toplam: string;
  firmaUnvani: string;
  alici: OdemeAlicisi;
  /** API kökü (PUBLIC_API_URL); dönüş ve form adresleri bundan kurulur. */
  apiKok: string;
  kartKaydet: boolean;
  /** Aynı sağlayıcıda kayıtlı kart varsa yeni kart aynı kullanıcı altında toplanır. */
  mevcutKart?: Record<string, string>;
}

/** PLT-14: sağlayıcının kart anahtarları; TekirExtra'da şifreli saklanır. */
export interface KayitliKart {
  anahtarlar: Record<string, string>;
  son4?: string;
  marka?: string;
}

export interface OdemeSonucu {
  basarili: boolean;
  odemeId?: string;
  tutar: number;
  dovizCinsi: string;
  kart?: KayitliKart;
}

export type KayitliOdemeSonucu = { durum: "odendi"; odemeId: string } | { durum: "bekliyor" } | { durum: "basarisiz"; hata: string };

/** Abonelik tahsilatının sağlayıcıdan bağımsız arayüzü; firma POS'undaki adaptörler yeniden kullanılır. */
export interface AbonelikOdemeSaglayicisi {
  /** Ödeyenin gideceği adres; `token` girişimde saklanır ve dönüşte eşleşmelidir. */
  odemeBaslat(g: OdemeGirdisi): Promise<{ token: string; odemeSayfasiUrl: string }>;
  /** iyzico: dönüşte sonuç sağlayıcıdan sorgulanır. PayTR'da sonuç bildirimle gelir (yok). */
  odemeSonucu?(token: string): Promise<OdemeSonucu>;
  kayitliKartlaOde(g: OdemeGirdisi, kart: Record<string, string>): Promise<KayitliOdemeSonucu>;
  kartSil(kart: Record<string, string>): Promise<void>;
}

const IYZICO_ADRESI: Record<SaglayiciOrtami, string> = { test: "https://sandbox-api.iyzipay.com", canli: "https://api.iyzipay.com" };

function iyzicoOrtak(g: OdemeGirdisi) {
  const adres = { contactName: g.firmaUnvani, address: g.alici.adres, city: g.alici.il, country: "Türkiye" };
  return {
    locale: "tr",
    conversationId: g.denemeId,
    price: g.toplam,
    paidPrice: g.toplam,
    currency: "TRY",
    basketId: g.denemeId,
    paymentGroup: "SUBSCRIPTION",
    buyer: {
      id: g.tenantId,
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
  };
}

export class IyzicoAbonelikSaglayicisi implements AbonelikOdemeSaglayicisi {
  constructor(
    private readonly ayar: EtkinSaglayici,
    private readonly adapter = new IyzicoAdapter(),
  ) {}

  private get config() {
    return { apiKey: this.ayar.config.apiKey, secretKey: this.ayar.config.secretKey, baseUrl: IYZICO_ADRESI[this.ayar.ortam] };
  }

  odemeBaslat(g: OdemeGirdisi) {
    return this.adapter.odemeBaslat(this.config, {
      ...iyzicoOrtak(g),
      enabledInstallments: [1],
      callbackUrl: `${g.apiKok}/api/v1/abonelik-odeme/iyzico/callback/${g.tenantId}/${g.denemeId}`,
      // Kayıtlı kart varsa ödeme sayfası onu da gösterir; yeni kart aynı kullanıcıya kaydolur.
      ...(g.mevcutKart?.cardUserKey ? { cardUserKey: g.mevcutKart.cardUserKey } : {}),
    });
  }

  async odemeSonucu(token: string): Promise<OdemeSonucu> {
    const s = await this.adapter.odemeSonucu(this.config, token);
    return { ...s, kart: s.kart ? { anahtarlar: { cardUserKey: s.kart.cardUserKey, cardToken: s.kart.cardToken }, son4: s.kart.son4, marka: s.kart.marka } : undefined };
  }

  async kayitliKartlaOde(g: OdemeGirdisi, kart: Record<string, string>): Promise<KayitliOdemeSonucu> {
    try {
      const s = await this.adapter.kayitliKartlaOde(this.config, {
        ...iyzicoOrtak(g),
        installment: 1,
        paymentChannel: "WEB",
        paymentCard: { cardUserKey: kart.cardUserKey, cardToken: kart.cardToken },
      });
      if (Number(s.tutar).toFixed(2) !== g.toplam || s.dovizCinsi !== "TRY") return { durum: "basarisiz", hata: "iyzico'nun bildirdiği tutar ya da döviz girişimle uyuşmuyor" };
      return { durum: "odendi", odemeId: s.odemeId };
    } catch (hata) {
      return { durum: "basarisiz", hata: (hata instanceof Error ? hata.message : String(hata)).slice(0, 500) };
    }
  }

  kartSil(kart: Record<string, string>) {
    return this.adapter.kartSil(this.config, kart.cardUserKey, kart.cardToken);
  }
}

/**
 * PayTR Direkt API: "ödeme sayfası" TekirExtra'nın sunduğu kart formudur
 * (form doğrudan PayTR'a gönderilir). Form, ödeyenin IP'siyle açıldığı anda
 * imzalanır; bu yüzden başlatma burada yalnız form adresini üretir.
 */
export class PaytrAbonelikSaglayicisi implements AbonelikOdemeSaglayicisi {
  constructor(
    private readonly ayar: EtkinSaglayici,
    private readonly adapter = new PaytrDirektAdapter(),
  ) {}

  get config(): PaytrDirektConfig {
    return { merchantId: this.ayar.config.magazaId, merchantKey: this.ayar.config.merchantKey, merchantSalt: this.ayar.config.merchantSalt, testModu: this.ayar.ortam === "test" };
  }

  private girdi(g: OdemeGirdisi, ip: string, token: string): PaytrOdemeGirdisi {
    const sonuc = `${g.apiKok}/api/v1/abonelik-odeme/paytr/sonuc/${g.tenantId}/${g.denemeId}?t=${token}`;
    return {
      merchantOid: merchantOid(g.tenantId, g.denemeId), userIp: ip, eposta: g.alici.eposta, tutar: g.toplam, urunAdi: g.aciklama,
      adSoyad: `${g.alici.ad} ${g.alici.soyad}`.trim(), adres: `${g.alici.adres} ${g.alici.il}`.trim(), telefon: g.alici.telefon?.replace(/\D/g, "") || "0000000000",
      okUrl: sonuc, failUrl: `${sonuc}&hata=1`,
    };
  }

  async odemeBaslat(g: OdemeGirdisi) {
    const token = randomBytes(24).toString("hex");
    return { token, odemeSayfasiUrl: `${g.apiKok}/api/v1/abonelik-odeme/paytr/form/${g.tenantId}/${g.denemeId}?t=${token}` };
  }

  /** Kart formunun gizli alanları; `ip` formu açan tarayıcının adresidir (PayTR imzaya katar). */
  formAlanlari(g: OdemeGirdisi, ip: string, token: string) {
    return paytrFormAlanlari(this.config, this.girdi(g, ip, token), { kaydet: g.kartKaydet, utoken: g.mevcutKart?.utoken });
  }

  async kayitliKartlaOde(g: OdemeGirdisi, kart: Record<string, string>): Promise<KayitliOdemeSonucu> {
    try {
      const s = await this.adapter.tekrarlayanOdeme(this.config, this.girdi(g, g.alici.ip ?? "127.0.0.1", "otomatik"), { utoken: kart.utoken, ctoken: kart.ctoken });
      // PayTR eşzamanlı yanıtta ödeme numarası vermez; sipariş numarası (merchant_oid) kullanılır.
      if (s.durum === "odendi") return { durum: "odendi", odemeId: merchantOid(g.tenantId, g.denemeId) };
      return s.durum === "bekliyor" ? { durum: "bekliyor" } : { durum: "basarisiz", hata: s.hata ?? "PayTR ödemeyi onaylamadı" };
    } catch (hata) {
      return { durum: "basarisiz", hata: (hata instanceof Error ? hata.message : String(hata)).slice(0, 500) };
    }
  }

  kartSil(kart: Record<string, string>) {
    return this.adapter.kartSil(this.config, kart.utoken, kart.ctoken);
  }

  /** Bildirimdeki utoken'la PayTR'daki kartlar; yeni kaydedilen kart listenin sonundadır. */
  async kaydedilenKart(utoken: string): Promise<KayitliKart | null> {
    const kartlar = await this.adapter.kartListesi(this.config, utoken);
    const k = kartlar[kartlar.length - 1];
    return k?.ctoken ? { anahtarlar: { utoken, ctoken: k.ctoken }, son4: k.last_4, marka: k.schema ?? k.c_brand } : null;
  }
}

export function saglayiciKur(ayar: EtkinSaglayici): AbonelikOdemeSaglayicisi {
  return ayar.saglayici === "iyzico" ? new IyzicoAbonelikSaglayicisi(ayar) : new PaytrAbonelikSaglayicisi(ayar);
}
