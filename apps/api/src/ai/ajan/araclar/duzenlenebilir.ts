/**
 * AI-107: onay talebinde kullanıcının karttan düzenleyebileceği üst düzey parametreler.
 * Kimlik (hedef kayıt) alanları listede yoktur: düzenleme başka kaydı hedefleyemez.
 * Düzenlenen değerler aracın kendi şemasıyla yeniden doğrulanır; araç onayda ekranın ucunu
 * kullanıcının rolüyle çağırdığı için kart üzerinden yetki genişlemez.
 */
export const DUZENLENEBILIR_ALANLAR: Record<string, string[]> = {
  belge_onayla: ["riskOnayGerekcesi"],
  fatura_kesinlestir: ["riskOnayGerekcesi"],
  teklif_revize_et: ["gerekce"],
  belge_eposta_gonder: ["eposta"],
  fatura_eposta_gonder: ["eposta"],
  cari_ekstre_eposta: ["alici", "baslangic", "bitis", "tur"],
  ekstre_satiri_eslestir: ["dagitim"],
  masraf_tamamla: ["odeme"],
  cari_guncelle: ["degisiklikler"],
  odeme_hatirlatmasi_gonder: ["kademe", "not"],
  crm_firsat_guncelle: ["degisiklikler"],
  uretim_emrini_kapat: ["neden"],
  izin_talebini_reddet: ["neden"],
  bilgi_talebini_reddet: ["neden"],
  gelen_efatura_yanit: ["gerekce"],
  gelen_eirsaliye_yanit: ["gerekce"],
  satin_alma_talebini_onayla: ["butceAsimGerekcesi"],
  satin_alma_talebini_reddet: ["gerekce"],
  satin_alma_teklif_sec: ["gerekce"],
  duzeltme_durum_degistir: ["aciklama"],
};
