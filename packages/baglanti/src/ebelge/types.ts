import type { BelgeDurum, EbelgeSaglayici } from "@tekirextra/shared";

/**
 * Entegratör erişim yapılandırması. Veritabanında AES-256-GCM ile şifreli
 * saklanır (EBLG-01b); bu tip yalnızca çözülmüş halin bellek-içi taşıyıcısıdır.
 * Loglara asla yazılmaz.
 */
export interface EntegratorConfig {
  saglayici: EbelgeSaglayici;
  kullaniciAdi: string;
  parola?: string;
  apiAnahtari?: string;
  servisAdresi?: string;
  /** Sovos e-Arşiv servisi e-Fatura servisinden ayrı bir WSDL adresidir. */
  earsivServisAdresi?: string;
  irsaliyeServisAdresi?: string;
  /** Entegratör servislerinde işlem yapan firmanın VKN/TCKN'si. */
  vknTckn?: string;
  /** Gönderici birim (GB) etiketi. */
  gondericiBirimEtiketi?: string;
  /** Posta kutusu (PK) etiketi; gelen belge ve yanıt akışında kullanılır. */
  postaKutusuEtiketi?: string;
}

export interface BaglantiSonuc {
  basarili: boolean;
  mesaj?: string;
}

export interface MukellefDurum {
  vknTckn: string;
  eFaturaMukellefi: boolean;
  /** Mükellefse GİB posta kutusu etiketi. */
  postaKutusu?: string;
}

/** ebelge modülünün ürettiği UBL-TR 1.2 belgesi — adaptör içeriğe dokunmaz (EBLG-03). */
export interface UblBelge {
  uuid: string;
  belgeNo: string;
  xml: string;
  tur: "efatura" | "earsiv";
  /** e-Fatura için alıcının GİB posta kutusu etiketi. */
  aliciPostaKutusu?: string;
}

export interface GonderimSonuc {
  basarili: boolean;
  /** Sağlayıcının belge takip referansı. */
  belgeRef?: string;
  hataMesaji?: string;
}

export interface BelgeDurumSonuc {
  belgeRef: string;
  durum: BelgeDurum;
  detay?: string;
}

export interface GelenBelge {
  uuid: string;
  belgeNo: string;
  gonderenVkn: string;
  gonderenUnvan: string;
  tarih: Date;
  xml: string;
}

export interface EarsivIptalGirdi {
  faturaNo: string;
  toplamTutar: string;
  iptalTarihi: Date;
  sube?: string;
}

export interface EarsivRapor {
  uuid: string;
  donem: string;
  baslangic: string;
  bitis: string;
  faturaSayisi: number;
  toplamTutar: string;
  gibDurumu: string;
}

export interface EirsaliyeBelge { uuid: string; belgeNo: string; xml: string; aliciPostaKutusu: string }
export interface GelenEirsaliye { uuid: string; belgeNo: string; gonderenVkn: string; gonderenUnvan: string; tarih: Date; xml: string }
