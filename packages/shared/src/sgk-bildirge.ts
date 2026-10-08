/**
 * PRS-23…28 (P3-3): SGK bildirge kod tabloları — API'deki XML/döküm üretimi
 * ve web formları aynı listeyi kullanır. Kaynak: SGK 4A toplu işe giriş/işten
 * ayrılış XML kılavuzu ve APHB-3.1.xsd (docs/sgk/). Eşlemeler ilk kullanımda
 * mali müşavirle doğrulanmalıdır.
 */

/** Kartta hazır seçilen belge türleri; diğer kodlar (1–92) elle girilir. */
export const SGK_BELGE_TURLERI: Record<string, string> = {
  "1": "Tüm sigorta kollarına tabi",
  "2": "Sosyal güvenlik destek primi (emekli)",
  "7": "Aday çırak / çırak (3308)",
  "13": "İşsizlik sigortası primi kesilmeyen",
  "22": "Zorunlu stajyer öğrenci",
};

/** İşe giriş XML'indeki sigorta kolu; eşlemesi olmayan belge türü dosyaya girmez. */
const SIGORTA_KOLU: Record<string, string> = { "1": "0", "13": "0", "2": "8", "7": "7", "22": "19" };
export const belgeTuruSigortaKolu = (belgeTuru: string): string | null => SIGORTA_KOLU[String(Number(belgeTuru))] ?? null;

export const OGRENIM_DURUMLARI = ["Bilinmeyen", "Okur yazar değil", "İlkokul", "Ortaokul / İ.Ö.O.", "Lise veya dengi", "Yüksekokul veya fakülte", "Yüksek lisans", "Doktora"] as const;

export const CSGB_IS_KOLLARI = [
  "Tarım ve ormancılık, avcılık ve balıkçılık", "Madencilik", "Petrol, kimya ve lastik", "Gıda sanayii", "Şeker", "Dokuma", "Deri", "Ağaç", "Kâğıt", "Basın ve yayın",
  "Banka ve sigorta", "Çimento, toprak ve cam", "Metal", "Gemi", "İnşaat", "Enerji", "Ticaret, büro, eğitim ve güzel sanatlar", "Kara taşımacılığı", "Demir yolu taşımacılığı", "Deniz taşımacılığı",
  "Hava taşımacılığı", "Ardiye ve antrepoculuk", "Haberleşme", "Sağlık", "Konaklama ve eğlence yerleri", "Millî savunma", "Gazetecilik", "Genel işler",
] as const;

export const SGK_CIKIS_KODLARI: Record<string, string> = {
  "01": "Deneme süreli iş sözleşmesinin işverence feshi", "02": "Deneme süreli iş sözleşmesinin işçi tarafından feshi", "03": "Belirsiz süreli iş sözleşmesinin işçi tarafından feshi",
  "04": "Belirsiz süreli iş sözleşmesinin işveren tarafından haklı sebep bildirilmeden feshi", "05": "Belirli süreli iş sözleşmesinin sona ermesi", "08": "Emeklilik (yaşlılık) veya toptan ödeme",
  "09": "Malulen emeklilik", "10": "Ölüm", "11": "İş kazası sonucu ölüm", "12": "Askerlik", "13": "Kadın işçinin evlenmesi", "14": "Emeklilik için yaş dışında diğer şartların tamamlanması",
  "15": "Toplu işçi çıkarma", "16": "Sözleşme sona ermeden aynı işverene ait işyerine nakil", "17": "İşyerinin kapanması", "18": "İşin sona ermesi", "19": "Mevsim bitimi", "20": "Kampanya bitimi",
  "21": "Statü değişikliği", "22": "Diğer nedenler", "23": "İşçi tarafından zorunlu nedenlerle fesih", "24": "İşçi tarafından sağlık nedeniyle fesih",
  "25": "İşçi tarafından işverenin ahlak ve iyiniyet kurallarına aykırı davranışı nedeniyle fesih", "26": "Disiplin kurulu kararı ile fesih", "27": "İşveren tarafından zorunlu nedenlerle ve tutukluluk nedeniyle fesih",
  "28": "İşveren tarafından sağlık nedeniyle fesih", "29": "İşveren tarafından işçinin ahlak ve iyiniyet kurallarına aykırı davranışı nedeniyle fesih", "30": "Vize süresinin bitimi",
  "31": "Borçlar, sendikalar, grev ve lokavt kanunu kapsamında kendi istek ve kusuru dışında", "32": "4046 s.K. 21. madde (özelleştirme)", "33": "Gazeteci tarafından sözleşmenin feshi",
  "34": "İşyerinin devri, işin veya işyerinin niteliğinin değişmesi", "35": "6495 s.K. ile devlet memurluğuna geçiş", "36": "KHK ile kamu görevinden çıkarma",
};

/** Yasal çıkış nedeninden SGK çıkış kodu önerisi (PRS-24); işten çıkış penceresinde değiştirilebilir. */
export const CIKIS_NEDENI_SGK_KODU = {
  isveren_fesih: "04", istifa: "03", emeklilik: "08", askerlik: "12", evlilik: "13", isci_hakli_fesih: "25",
  isveren_saglik_zorlayici: "28", ahlak_iyiniyet: "29", deneme_suresi: "01", belirli_sure_bitimi: "05", olum: "10", diger: "22",
} as const satisfies Record<string, string>;

