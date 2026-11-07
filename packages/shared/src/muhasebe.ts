/**
 * MUH-02/06 (karar 2026-10-03): muhasebe aktarımının hesap anahtarları,
 * Tekdüzen hesap planı varsayılanları ve dosya profili. Firma her kodu
 * Ayarlar'da değiştirir; değiştirilmeyen anahtar buradaki koda düşer.
 */
export const MUHASEBE_HESAPLARI = {
  kasa: { kod: "100", ad: "Kasa" },
  alinan_cek: { kod: "101", ad: "Alınan çekler" },
  banka: { kod: "102", ad: "Bankalar" },
  verilen_cek: { kod: "103", ad: "Verilen çekler ve ödeme emirleri" },
  pos: { kod: "108", ad: "Diğer hazır değerler (POS)" },
  alici: { kod: "120", ad: "Alıcılar" },
  alacak_senedi: { kod: "121", ad: "Alacak senetleri" },
  karsiliksiz: { kod: "128", ad: "Şüpheli ticari alacaklar (karşılıksız çek/senet)" },
  diger_alacak: { kod: "136", ad: "Diğer çeşitli alacaklar (carisiz gelir)" },
  sarf_alis: { kod: "150", ad: "İlk madde ve malzeme (sarf alımı)" },
  mal_alis: { kod: "153", ad: "Ticari mallar" },
  indirilecek_kdv: { kod: "191", ad: "İndirilecek KDV" },
  pesin_vergi: { kod: "193", ad: "Peşin ödenen vergiler ve fonlar (gelir, satış ve e-ticaret stopajı)" },
  personel_avans: { kod: "196", ad: "Personel avansları" },
  kisa_vadeli_kredi: { kod: "300", ad: "Banka kredileri (kısa vadeli)" },
  kredi_karti: { kod: "309", ad: "Diğer mali borçlar (kredi kartı)" },
  satici: { kod: "320", ad: "Satıcılar" },
  borc_senedi: { kod: "321", ad: "Borç senetleri" },
  diger_ticari_borc: { kod: "329", ad: "Diğer ticari borçlar (carisiz masraf)" },
  personel_borc: { kod: "335", ad: "Personele borçlar (net ücret)" },
  diger_cesitli_borc: { kod: "336", ad: "Diğer çeşitli borçlar (bordro kesintileri: sendika, sigorta)" },
  odenecek_vergi: { kod: "360", ad: "Ödenecek vergi ve fonlar (KDV tevkifatı, stopaj, bordro GV/DV)" },
  odenecek_sgk: { kod: "361", ad: "Ödenecek sosyal güvenlik kesintileri (SGK, işsizlik)" },
  hesaplanan_kdv: { kod: "391", ad: "Hesaplanan KDV" },
  uzun_vadeli_kredi: { kod: "400", ad: "Banka kredileri (uzun vadeli)" },
  yurtici_satis: { kod: "600", ad: "Yurtiçi satışlar" },
  yurtdisi_satis: { kod: "601", ad: "Yurtdışı satışlar" },
  satis_iade: { kod: "610", ad: "Satıştan iadeler" },
  kur_farki_gelir: { kod: "646", ad: "Kambiyo kârları (kur farkı geliri)" },
  diger_gelir: { kod: "649", ad: "Diğer olağan gelir ve kârlar (kategorisiz gelir)" },
  cari_duzeltme_gelir: { kod: "679", ad: "Diğer olağandışı gelir ve kârlar (cari düzeltme, borç yönlü)" },
  kur_farki_gider: { kod: "656", ad: "Kambiyo zararları (kur farkı gideri)" },
  cari_duzeltme_gider: { kod: "689", ad: "Diğer olağandışı gider ve zararlar (cari düzeltme, alacak yönlü)" },
  pazaryeri_kesinti: { kod: "760", ad: "Pazarlama satış ve dağıtım giderleri (pazaryeri kesintisi)" },
  hizmet_alis: { kod: "770", ad: "Genel yönetim giderleri (hizmet alımı, kategorisiz masraf)" },
  ucret_gideri: { kod: "770", ad: "Ücret giderleri (brüt ücret, izin ücreti, işveren SGK/işsizlik payı)" },
  tazminat_gideri: { kod: "770", ad: "Kıdem ve ihbar tazminatı giderleri" },
  // DMR-01/09: sabit kıymet sınıflarının hesapları, birikmiş amortisman ve elden çıkarma.
  dmr_bina: { kod: "252", ad: "Binalar" },
  dmr_tesis_makine: { kod: "253", ad: "Tesis, makine ve cihazlar" },
  dmr_tasit: { kod: "254", ad: "Taşıtlar" },
  dmr_demirbas: { kod: "255", ad: "Demirbaşlar" },
  dmr_hak: { kod: "260", ad: "Haklar" },
  dmr_ozel_maliyet: { kod: "264", ad: "Özel maliyetler" },
  birikmis_amortisman: { kod: "257", ad: "Birikmiş amortismanlar (-)" },
  birikmis_itfa: { kod: "268", ad: "Birikmiş amortismanlar (-) (maddi olmayan duran varlıklar)" },
  amortisman_gideri: { kod: "770", ad: "Amortisman gideri (genel yönetim)" },
  dmr_satis_kari: { kod: "679", ad: "Diğer olağandışı gelir ve kârlar (sabit kıymet satış kârı)" },
  dmr_satis_zarari: { kod: "689", ad: "Diğer olağandışı gider ve zararlar (sabit kıymet satış zararı)" },
} as const;

export type MuhasebeHesapAnahtari = keyof typeof MUHASEBE_HESAPLARI;
export const MUHASEBE_HESAP_ANAHTARLARI = Object.keys(MUHASEBE_HESAPLARI) as MuhasebeHesapAnahtari[];

/** Kod biçimi: rakamla başlar; nokta, tire ve harf/rakamla alt hesaplara iner. */
export const MUHASEBE_KODU_DESENI = /^[0-9][0-9A-Za-z.\-_]{0,39}$/;

export const AKTARIM_ALANLARI = {
  fisNo: "Fiş no",
  fisTarihi: "Fiş tarihi",
  fisTuru: "Fiş türü",
  fisAciklama: "Fiş açıklaması",
  satirNo: "Satır no",
  hesapKodu: "Hesap kodu",
  aciklama: "Açıklama",
  borc: "Borç",
  alacak: "Alacak",
  belgeNo: "Belge no",
  belgeTarihi: "Belge tarihi",
  dovizCinsi: "Döviz",
  dovizTutar: "Döviz tutarı",
  kur: "Kur",
  kaynak: "Kaynak",
} as const;
export type AktarimAlani = keyof typeof AKTARIM_ALANLARI;

export interface AktarimProfili {
  ad: string;
  bicim: "xlsx" | "csv";
  sutunlar: Array<{ alan: AktarimAlani; baslik: string }>;
  tarihBicimi: "GG.AA.YYYY" | "YYYY-AA-GG";
  ondalik: "," | ".";
  csvAyirici: ";" | "," | "\t";
}

const sutun = (alan: AktarimAlani, baslik: string = AKTARIM_ALANLARI[alan]) => ({ alan, baslik });

export const HAZIR_AKTARIM_PROFILLERI: Record<"genel" | "luca", AktarimProfili> = {
  genel: {
    ad: "Genel",
    bicim: "xlsx",
    sutunlar: (Object.keys(AKTARIM_ALANLARI) as AktarimAlani[]).map((a) => sutun(a)),
    tarihBicimi: "GG.AA.YYYY",
    ondalik: ",",
    csvAyirici: ";",
  },
  /** MUH-06: Luca'nın Excel'den fiş aktarımına göre; mali müşavirle doğrulanmalıdır. */
  luca: {
    ad: "Luca (Excel fiş aktarımı)",
    bicim: "xlsx",
    sutunlar: [
      sutun("fisNo", "Fiş No"),
      sutun("fisTarihi", "Fiş Tarihi"),
      sutun("fisAciklama", "Fiş Açıklama"),
      sutun("hesapKodu", "Hesap Kodu"),
      sutun("belgeNo", "Evrak No"),
      sutun("belgeTarihi", "Evrak Tarihi"),
      sutun("aciklama", "Detay Açıklama"),
      sutun("borc", "Borç"),
      sutun("alacak", "Alacak"),
      sutun("dovizCinsi", "Para Birimi"),
      sutun("kur", "Kur"),
      sutun("dovizTutar", "Döviz Tutar"),
    ],
    tarihBicimi: "GG.AA.YYYY",
    ondalik: ",",
    csvAyirici: ";",
  },
};
