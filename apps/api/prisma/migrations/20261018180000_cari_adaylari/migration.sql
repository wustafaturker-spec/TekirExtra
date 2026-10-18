-- AI-44…47: gönderen kesin eşleşmezse yaklaşık cari adayları kullanıcıya seçtirilir.
ALTER TABLE eposta_teklif_islemleri ADD COLUMN cari_adaylari JSONB NOT NULL DEFAULT '[]';
ALTER TABLE eposta_teklif_islemleri DROP CONSTRAINT eposta_teklif_islemleri_durum_check;
ALTER TABLE eposta_teklif_islemleri ADD CONSTRAINT eposta_teklif_islemleri_durum_check
  CHECK (durum IN ('isleniyor', 'atlandi', 'teklif_degil', 'incelenmeli', 'cari_secimi', 'cari_onayi_bekliyor', 'cari_yok', 'taslak_hazir', 'sinirda', 'hata'));
