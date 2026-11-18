-- END-16: fiyat değişikliği genel onay kurallarından geçer.
ALTER TABLE onay_kurallari DROP CONSTRAINT onay_kurallari_islem_check;
ALTER TABLE onay_kurallari ADD CONSTRAINT onay_kurallari_islem_check CHECK (islem IN (
 'fatura_kesinlestir_satis', 'fatura_kesinlestir_alis', 'belge_onayla_satis',
 'masraf_onayla', 'kasa_banka_odeme', 'fiyat_listesi_guncelle'
));
