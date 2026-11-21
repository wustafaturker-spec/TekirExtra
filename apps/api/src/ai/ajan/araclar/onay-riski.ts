/**
 * AI-108: onaya tabi araçların risk sınıfı. Telegram'dan `finansal` onay ek doğrulama
 * (TOTP) ister ya da web'e yönlendirilir; `dusuk` onay tek dokunuşla verilir.
 * Her onay aracı iki listeden birinde olmalıdır (`onay-riski.test.ts`); yeni araç
 * sınıfsız kalamaz.
 */
export type OnayRiski = "dusuk" | "finansal";

/** Para, muhasebe kaydı ya da yasal e-Belge yanıtı doğuran işlemler. */
export const FINANSAL_ONAY_ARACLARI: ReadonlySet<string> = new Set([
  "fatura_kesinlestir", "fatura_iptal", "masraf_tamamla",
  "kasa_banka_hareketi_kaydet", "ekstre_satiri_eslestir",
  "ebelge_gonder", "odeme_hatirlatmasi_gonder",
  // Gelen e-Fatura: alış faturası kaydı ve GİB'e giden kabul/ret yanıtı.
  "gelen_efatura_isle", "gelen_efatura_yanit",
]);

/** Kart, taslak ve iş akışı işlemleri; para hareketi ya da kesin kayıt doğurmaz. */
export const DUSUK_RISKLI_ONAY_ARACLARI: ReadonlySet<string> = new Set([
  "belge_onayla", "belge_iptal", "belge_donustur", "teklif_revize_et",
  "belge_eposta_gonder", "fatura_eposta_gonder", "cari_ekstre_eposta",
  "cari_olustur", "cari_guncelle", "stok_karti_olustur", "stok_karti_guncelle",
  "gelen_epostadan_crm_gorevi_ac", "gelen_eposta_durum_guncelle",
  "gelen_efatura_xml_yukle", "gelen_eirsaliye_yanit",
  // Satın alma ve düzeltme adımları genel onay akışına (ONY) ayrıca tabidir.
  "satin_alma_talebini_onaya_sun", "satin_alma_talebini_onayla", "satin_alma_talebini_reddet", "satin_alma_teklif_sec", "satin_alma_siparise_donustur",
  "duzeltme_ata", "duzeltme_durum_degistir",
  "crm_firsat_guncelle", "crm_firsat_asama_degistir",
  "uretim_emrini_planla", "uretim_malzemesini_rezerve_et", "uretim_emrini_iptal_et", "uretim_emrini_kapat",
  "izin_talebini_onayla", "izin_talebini_reddet", "bilgi_talebini_onayla", "bilgi_talebini_reddet",
]);

/** Listede olmayan araç güvenli tarafta kalır: finansal sayılır. */
export function onayRiski(arac: string): OnayRiski {
  return DUSUK_RISKLI_ONAY_ARACLARI.has(arac) ? "dusuk" : "finansal";
}
