import type { AiAracTanimi } from "../../saglayici/ai-provider.interface";

/**
 * AI-84: asistana her mesajda bütün araçlar değil, işe yarayacak gruplar
 * sunulur. Çekirdek grup her zaman vardır; diğerleri ekrandan, mesajdaki
 * sözcüklerden ve sohbette daha önce kullanılan araçlardan seçilir. Model
 * listede olmayan bir işe ihtiyaç duyarsa `arac_gruplarini_ac` ile grubu
 * kendisi açar. MCP bu süzgeçten geçmez; bütün araçları görür.
 */
export const ARAC_GRUPLARI = {
  cekirdek: "Cari, stok, teklif/sipariş/irsaliye ve fatura arama/okuma; raporlar; rapor/belge/ekstre dosyası (Excel, PDF); bildirimler; günlük brifing.",
  satis: "Teklif, sipariş, irsaliye ve fatura taslağı, onay, dönüştürme, iptal, e-posta ve e-Belge gönderimi; fiyat önerisi.",
  kart: "Cari ve stok kartı oluşturma ve güncelleme.",
  tahsilat: "Vadesi geçen alacaklar, tahsilat öncelik ve riski, ödeme hatırlatması, cari ekstre e-postası, CRM görevi.",
  finans: "Kasa/banka hesapları ve hareketi, masraf, gelir-gider, finansal özet, çek/senet, kredi, kredi kartı, ödeme talimatı, bütçe, nakit pozisyonu, demirbaş ve amortisman, araçlar.",
  eposta: "Gelen e-postalar: arama, okuma, ek OCR, eşitleme, durum, e-postadan CRM görevi.",
  gelen_ebelge: "Gelen e-Fatura ve e-İrsaliye: arama, okuma, faturaya işleme, kabul/ret yanıtı, XML yükleme.",
  satin_alma: "Satın alma talepleri: oluşturma, teklif ekleme/seçme, onay/ret, siparişe dönüştürme.",
  denetim: "Düzeltme Merkezi kayıtları, atama ve durum; dönem kapatma kontrolleri.",
  uretim: "Üretim emirleri (arama, ayrıntı, taslak, planlama, malzeme ayırma, kapatma, iptal), reçete, kapasite, kalite, üretim maliyeti.",
  personel: "Personel kadrosu, izin talepleri ve bakiyesi, avans özeti, bilgi talepleri, toplu personel maliyeti; izin ve bilgi talebi onay/ret.",
  crm: "CRM satış fırsatları: arama, ayrıntı, yeni fırsat, fırsattan teklif, güncelleme ve aşama değişikliği.",
  endeks: "Enflasyon (TÜFE, Yİ-ÜFE) ve kur endeksleri; ürün fiyatının endeksle karşılaştırması ve reel değişimi.",
} as const;

export type AracGrubu = keyof typeof ARAC_GRUPLARI;

export const GRUP_ARACLARI: Record<AracGrubu, string[]> = {
  cekirdek: ["cari_ara", "cari_getir", "cari_ekstre_dosyasi", "stok_ara", "stok_getir", "belge_ara", "belge_getir", "fatura_ara", "fatura_getir", "rapor_katalogu", "rapor_calistir", "rapor_dosyasi", "belge_pdf", "bildirimler", "gunluk_brifing", "sozlesme_ara_ve_sor"],
  satis: ["fiyat_onerisi", "belge_taslagi_olustur", "fatura_taslagi_olustur", "belge_onayla", "belge_iptal", "belge_donustur", "teklif_revize_et", "fatura_kesinlestir", "fatura_iptal", "fatura_fiyat_sapmasi", "belge_eposta_gonder", "fatura_eposta_gonder", "ebelge_gonder"],
  kart: ["cari_olustur", "cari_guncelle", "stok_karti_olustur", "stok_karti_guncelle"],
  tahsilat: ["vadesi_gecen_alacaklar", "tahsilat_oncelikleri", "tahsilat_riski", "cari_durumu", "odeme_hatirlatmasi_gonder", "cari_ekstre_eposta", "crm_gorevi_olustur"],
  finans: ["kasa_banka_hesaplari", "kasa_banka_hareketi_kaydet", "ekstre_satiri_eslestir", "masraf_kategorileri", "masraf_taslagi_olustur", "masraf_tamamla", "finansal_ozet", "gelir_gider", "cek_senet_ara", "cek_senet_ozet", "krediler", "kredi_kartlari", "odeme_talimatlari", "butce_karsilastirma", "nakit_pozisyonu", "demirbaslar", "araclar"],
  eposta: ["gelen_eposta_ara", "gelen_eposta_getir", "gelen_eposta_ek_ocr", "gelen_eposta_senkronize_et", "gelen_eposta_durum_guncelle", "gelen_epostadan_crm_gorevi_ac"],
  gelen_ebelge: ["gelen_efatura_ara", "gelen_efatura_getir", "gelen_efatura_isle", "gelen_efatura_yanit", "gelen_efatura_xml_yukle", "gelen_eirsaliye_ara", "gelen_eirsaliye_getir", "gelen_eirsaliye_yanit"],
  satin_alma: ["satin_alma_secenekleri", "satin_alma_talep_ara", "satin_alma_talep_getir", "satin_alma_talebi_olustur", "satin_alma_talebini_onaya_sun", "satin_alma_teklif_ekle", "satin_alma_talebini_onayla", "satin_alma_talebini_reddet", "satin_alma_teklif_sec", "satin_alma_siparise_donustur"],
  denetim: ["duzeltme_kayitlari", "duzeltme_ata", "duzeltme_durum_degistir", "donem_kapatma_kontrolleri"],
  uretim: ["uretim_ozeti", "uretim_emri_ara", "uretim_emri_getir", "uretim_kapasite", "recete_getir", "kalite_kontrolleri", "uretim_maliyet_raporu", "uretim_emri_taslagi_olustur", "uretim_emrini_planla", "uretim_malzemesini_rezerve_et", "uretim_emrini_iptal_et", "uretim_emrini_kapat"],
  personel: ["personel_ara", "personel_getir", "personel_ozeti", "personel_maliyet_raporu", "izin_talepleri", "izin_bakiyesi", "avans_ozeti", "bilgi_talepleri", "izin_talebini_onayla", "izin_talebini_reddet", "bilgi_talebini_onayla", "bilgi_talebini_reddet"],
  crm: ["crm_firsat_ara", "crm_firsat_getir", "crm_firsat_olustur", "crm_firsattan_teklif", "crm_firsat_guncelle", "crm_firsat_asama_degistir"],
  endeks: ["endeks_getir", "fiyat_endeks_karsilastir"],
};

const ARACIN_GRUBU = new Map<string, AracGrubu>(
  (Object.entries(GRUP_ARACLARI) as [AracGrubu, string[]][]).flatMap(([g, adlar]) => adlar.map((ad) => [ad, g] as const)),
);

export function aracGrubu(ad: string): AracGrubu | undefined {
  return ARACIN_GRUBU.get(ad);
}

/** Türkçe harfleri sadeleştirir; "Gelen İrsaliye" → "gelen irsaliye". */
function sadelestir(metin: string): string {
  return metin
    .replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase()
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c");
}

const SOZCUK_GRUPLARI: Array<[RegExp, AracGrubu[]]> = [
  [/teklif|siparis|irsaliye|fatura|fiyat|satis|e-?arsiv|e-?belge|kesinlestir|donustur|iptal|reviz|sapma/, ["satis"]],
  [/cari|musteri|tedarikci|stok|urun|kart/, ["kart"]],
  [/tahsil|alacak|vade|borc|hatirlat|risk|ekstre|ektre|dokum|mutabakat|crm|gorev|analiz/, ["tahsilat"]],
  [/kasa|banka|masraf|gider|gelir|kar\b|kâr|zarar|ciro|nakit|cek\b|cekler|senet|kredi|odeme|butce|bakiye|finans|virman|pos\b/, ["finans"]],
  [/e-?posta|mail|ileti|imap|ocr/, ["eposta"]],
  [/gelen|alis faturasi|tedarikci faturasi|xml|ubl|kabul|\bret\b|\bred\b|reddet/, ["gelen_ebelge"]],
  [/satin ?al|tedarik|talep/, ["satin_alma"]],
  [/duzeltme|hata|donem|kapanis|kapat/, ["denetim"]],
  [/uretim|imalat|emir|recete|kapasite|kalite|is merkezi|mamul/, ["uretim"]],
  [/personel|calisan|izin|bordro|maas|avans|kadro|ise giris|isten|departman/, ["personel"]],
  [/firsat|huni|lead|aday musteri|pazarlik|kazanil|kaybedil|crm/, ["crm"]],
  [/enflasyon|tufe|ufe|endeks|reel|zam orani|zamlar|kur artis|dolar|euro|evds/, ["endeks"]],
];

/** AI-78 ekran kaydı türü → grup. */
const EKRAN_GRUPLARI: Record<string, AracGrubu[]> = {
  cari: ["tahsilat", "satis", "kart"],
  stok: ["kart", "satis", "endeks"],
  fatura: ["satis", "tahsilat"],
  belge: ["satis"],
  gelen_efatura: ["gelen_ebelge"],
  gelen_eirsaliye: ["gelen_ebelge"],
  satin_alma_talebi: ["satin_alma"],
  rapor: ["finans"],
};

/** Panel sayfası yolu → grup; ilk eşleşen önek kullanılır. */
const SAYFA_GRUPLARI: Array<[string, AracGrubu[]]> = [
  ["/panel/fatura/gelen-kutusu", ["gelen_ebelge"]],
  ["/panel/ebelge", ["gelen_ebelge", "satis"]],
  ["/panel/fatura", ["satis", "tahsilat"]],
  ["/panel/belgeler", ["satis"]],
  ["/panel/satis", ["satis"]],
  ["/panel/cari", ["tahsilat", "kart"]],
  ["/panel/stok", ["kart", "satis"]],
  ["/panel/crm", ["crm", "tahsilat"]],
  ["/panel/kasa-banka", ["finans"]],
  ["/panel/masraflar", ["finans"]],
  ["/panel/gelirler", ["finans"]],
  ["/panel/butce", ["finans"]],
  ["/panel/nakit-akisi", ["finans"]],
  ["/panel/raporlar", ["finans"]],
  ["/panel/eposta", ["eposta"]],
  ["/panel/is-kutusu", ["eposta", "satis"]],
  ["/panel/satin-alma", ["satin_alma"]],
  ["/panel/islemler", ["denetim"]],
  ["/panel/donem-kapatma", ["denetim", "finans"]],
  ["/panel/uretim", ["uretim"]],
  ["/panel/personel", ["personel"]],
  ["/panel/self-servis", ["personel"]],
];

export const SAYFA_YOLU = /^\/panel(\/[a-z0-9-]+){0,4}\/?$/;

export function gruplariSec(g: { mesaj: string; ekranTuru?: string; sayfa?: string; gecmisAraclar?: string[] }): Set<AracGrubu> {
  const secilen = new Set<AracGrubu>(["cekirdek"]);
  const ekle = (gruplar: readonly AracGrubu[] | undefined) => gruplar?.forEach((x) => secilen.add(x));
  const metin = sadelestir(g.mesaj);
  for (const [desen, gruplar] of SOZCUK_GRUPLARI) if (desen.test(metin)) ekle(gruplar);
  if (g.ekranTuru) ekle(EKRAN_GRUPLARI[g.ekranTuru]);
  if (g.sayfa) ekle(SAYFA_GRUPLARI.find(([onek]) => g.sayfa === onek || g.sayfa!.startsWith(`${onek}/`))?.[1]);
  for (const ad of g.gecmisAraclar ?? []) { const grup = aracGrubu(ad); if (grup) secilen.add(grup); }
  return secilen;
}

export const GRUP_ACMA_ARACI = "arac_gruplarini_ac";

/** Modelin kapalı bir grubu açması için sanal araç; uca gitmez, döngü içinde ele alınır. */
export function grupAcmaTanimi(kapali: AracGrubu[]): AiAracTanimi {
  return {
    ad: GRUP_ACMA_ARACI,
    aciklama: "Bu sohbette şu an sunulmayan araç gruplarını açar. Kullanıcının istediği iş için uygun araç listede yoksa 'yapamam' demeden önce ilgili grubu aç; açılan araçlar sonraki adımda kullanılabilir. Kapalı gruplar: "
      + kapali.map((g) => `${g}: ${ARAC_GRUPLARI[g]}`).join(" | "),
    girdiSemasi: {
      type: "object",
      properties: { gruplar: { type: "array", items: { type: "string", enum: kapali }, description: "Açılacak grup adları" } },
      required: ["gruplar"],
    },
  };
}
