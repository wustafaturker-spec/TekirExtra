/**
 * SGK faturası (SGK e-Fatura Uygulama Kılavuzu ve e-Fatura Teknik Doküman,
 * 29.09.2017 v1.0; şematron `InvoiceTypeCode` sabitleri).
 *
 * Sosyal Güvenlik Kurumu'na kesilen e-Fatura `InvoiceTypeCode` **SGK** ile
 * gider ve beş ek alan taşır: faturanın hangi gruba ait olduğunu söyleyen
 * **ilave fatura tipi** (`cbc:AccountingCost`), sağlık hizmeti sunucusunun
 * Kurum'da tanımlı **kodu ve adı**, **dosya no** ve fatura **dönemi**
 * (`cac:InvoicePeriod`). Kod, ad ve dosya no belgeye ayrı ayrı
 * `cac:AdditionalDocumentReference` blokları olarak yazılır; değer
 * `DocumentType`, hangi alan olduğu `DocumentTypeCode` içindedir.
 *
 * Kararlar (2026-09-20): alıcının VKN'si SGK'nınki ise belge kendiliğinden bu
 * türe düşer (kartta işaret aranmaz); yedi grubun hepsi desteklenir; alanlar
 * sihirbazda toplanır, sabit olanların (ilave fatura tipi, mükellef kodu/adı)
 * varsayılanı firma kartında durur; senaryo TEMELFATURA'ya zorlanır — kılavuz
 * "Temel Fatura Senaryosu üzerinden yürütülecektir" diyor.
 */

/** SGK Başkanlığı, Çankaya VD (kılavuz §3). */
export const SGK_VKN = "7750409379";
export const SGK_UNVAN = "SOSYAL GÜVENLİK KURUMU BAŞKANLIĞI";
export const SGK_VERGI_DAIRESI = "Çankaya";

/** UBL'e yazılan fatura tipi. */
export const SGK_FATURA_TIPI = "SGK";

/** Kurum'da kayıt yoksa kod ve dosya no alanlarına yazılan değer. */
export const SGK_TANIMSIZ_KOD = "0000";

export interface IlaveFaturaTipi {
  kod: string;
  ad: string;
  /** Doluysa mükellef kodu ve adı istenir (yalnız sağlık hizmeti sunucuları). */
  mukellefKoduEtiketi?: string;
  mukellefAdiEtiketi?: string;
  /** Doluysa dosya no istenir; etiket grubun anlamını söyler. */
  dosyaNoEtiketi?: string;
  /** Dönem istenir mi (MAL_HIZMET ve DIGER'de istenmez). */
  donem: boolean;
}

export const ILAVE_FATURA_TIPLERI: readonly IlaveFaturaTipi[] = [
  {
    kod: "SAGLIK_HAS", ad: "Hastane",
    mukellefKoduEtiketi: "Sağlık tesis kodu", mukellefAdiEtiketi: "Sağlık tesisi adı",
    dosyaNoEtiketi: "MEDULA evrak referans no", donem: true,
  },
  {
    kod: "SAGLIK_ECZ", ad: "Eczane",
    mukellefKoduEtiketi: "Eczane sicil numarası", mukellefAdiEtiketi: "Eczane adı",
    dosyaNoEtiketi: "Evrak no", donem: true,
  },
  {
    kod: "SAGLIK_OPT", ad: "Optik",
    mukellefKoduEtiketi: "Optisyenlik müessesesi tesis kodu", mukellefAdiEtiketi: "Optisyenlik müessesesi adı",
    dosyaNoEtiketi: "Evrak no", donem: true,
  },
  {
    kod: "SAGLIK_MED", ad: "Medikal",
    mukellefKoduEtiketi: "Satış merkezi kodu", mukellefAdiEtiketi: "Satış merkezi adı",
    dosyaNoEtiketi: "Evrak no", donem: true,
  },
  { kod: "ABONELIK", ad: "Abonelik (elektrik, telefon, internet…)", dosyaNoEtiketi: "Abone no", donem: true },
  { kod: "MAL_HIZMET", ad: "Mal / hizmet alımı", dosyaNoEtiketi: "Harcama referans no (yoksa harcama birim no)", donem: false },
  { kod: "DIGER", ad: "Diğer", donem: false },
];

const TIP_HARITASI = new Map(ILAVE_FATURA_TIPLERI.map((t) => [t.kod, t]));

export function ilaveFaturaTipiBul(kod: string | null | undefined): IlaveFaturaTipi | undefined {
  return kod ? TIP_HARITASI.get(kod) : undefined;
}

/** Alıcı SGK mı — karar VKN'dendir, kartta işaret aranmaz. */
export function sgkFaturasiMi(vknTckn: string | null | undefined): boolean {
  return (vknTckn ?? "").replace(/\s/g, "") === SGK_VKN;
}

export interface SgkBilgisi {
  ilaveFaturaTipi?: string | null;
  mukellefKodu?: string | null;
  mukellefAdi?: string | null;
  dosyaNo?: string | null;
  donemBaslangic?: string | null;
  donemBitis?: string | null;
}

export type SgkAlan = "ilaveFaturaTipi" | "mukellefKodu" | "mukellefAdi" | "dosyaNo" | "donemBaslangic" | "donemBitis";

export interface SgkEngeli {
  alan: SgkAlan;
  mesaj: string;
}

const gun = (deger: string | null | undefined) => (deger ?? "").slice(0, 10);

/**
 * Gönderimi engelleyen eksikler. Zorunluluklar gruba göre değişir: mükellef
 * kodu/adı yalnız sağlık hizmeti sunucularında, dosya no DİĞER dışında her
 * grupta, dönem MAL_HIZMET ve DİĞER dışında istenir (teknik doküman §3.3).
 */
export function sgkEngelleri(bilgi: SgkBilgisi): SgkEngeli[] {
  const tip = ilaveFaturaTipiBul(bilgi.ilaveFaturaTipi);
  if (!tip) {
    return [{ alan: "ilaveFaturaTipi", mesaj: "SGK faturasında ilave fatura tipi seçilmelidir" }];
  }
  const engeller: SgkEngeli[] = [];

  if (tip.mukellefKoduEtiketi && !bilgi.mukellefKodu?.trim()) {
    engeller.push({ alan: "mukellefKodu", mesaj: `${tip.mukellefKoduEtiketi} girilmelidir (Kurum'da tanımlı kod yoksa ${SGK_TANIMSIZ_KOD})` });
  }
  if (tip.mukellefAdiEtiketi && !bilgi.mukellefAdi?.trim()) {
    engeller.push({ alan: "mukellefAdi", mesaj: `${tip.mukellefAdiEtiketi} girilmelidir (Kurum'da tanımlı ad yoksa ruhsattaki ad)` });
  }
  if (tip.dosyaNoEtiketi && !bilgi.dosyaNo?.trim()) {
    engeller.push({ alan: "dosyaNo", mesaj: `${tip.dosyaNoEtiketi} girilmelidir (numara üretilmediyse ${SGK_TANIMSIZ_KOD})` });
  }
  if (tip.donem) {
    const baslangic = gun(bilgi.donemBaslangic);
    const bitis = gun(bilgi.donemBitis);
    if (!baslangic) engeller.push({ alan: "donemBaslangic", mesaj: "Faturanın ait olduğu dönemin başlangıcı girilmelidir" });
    if (!bitis) engeller.push({ alan: "donemBitis", mesaj: "Faturanın ait olduğu dönemin bitişi girilmelidir" });
    if (baslangic && bitis && bitis < baslangic) {
      engeller.push({ alan: "donemBitis", mesaj: "Dönem bitişi başlangıcından önce olamaz" });
    }
  }
  return engeller;
}

/** Belgeye yazılacak alanlar; gruba girmeyenler yazılmaz (boş kalmalıdır). */
export function sgkBelgeAlanlari(bilgi: SgkBilgisi): {
  ilaveFaturaTipi: string;
  mukellefKodu?: { deger: string; aciklama: string };
  mukellefAdi?: { deger: string; aciklama: string };
  dosyaNo?: { deger: string; aciklama: string };
  donem?: { baslangic: string; bitis: string };
} | null {
  const tip = ilaveFaturaTipiBul(bilgi.ilaveFaturaTipi);
  if (!tip) return null;
  return {
    ilaveFaturaTipi: tip.kod,
    mukellefKodu: tip.mukellefKoduEtiketi && bilgi.mukellefKodu?.trim()
      ? { deger: bilgi.mukellefKodu.trim(), aciklama: tip.mukellefKoduEtiketi } : undefined,
    mukellefAdi: tip.mukellefAdiEtiketi && bilgi.mukellefAdi?.trim()
      ? { deger: bilgi.mukellefAdi.trim(), aciklama: tip.mukellefAdiEtiketi } : undefined,
    dosyaNo: tip.dosyaNoEtiketi && bilgi.dosyaNo?.trim()
      ? { deger: bilgi.dosyaNo.trim(), aciklama: tip.dosyaNoEtiketi } : undefined,
    donem: tip.donem && gun(bilgi.donemBaslangic) && gun(bilgi.donemBitis)
      ? { baslangic: gun(bilgi.donemBaslangic), bitis: gun(bilgi.donemBitis) } : undefined,
  };
}
