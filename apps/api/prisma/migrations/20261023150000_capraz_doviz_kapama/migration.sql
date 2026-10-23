-- KSB-19…24: ödemenin farklı dövizli faturaya sonradan (elle) bağlanması.
-- tutar faturanın dövizindedir; kaynak_tutari ödemenin kendi dövizinde düşülen kısım,
-- kaynak_tutari_try onun TL değeri (kur farkı bununla fatura kurundaki TL değeri arasındadır).
-- kaynak_tutari boşsa kaynak ile fatura aynı dövizdedir ve tutar kaynaktan düşülür.
ALTER TABLE fatura_kapamalari
  ADD COLUMN kaynak_tutari DECIMAL(15, 2),
  ADD COLUMN kaynak_tutari_try DECIMAL(15, 2),
  ADD COLUMN kur_farki_fatura_id UUID REFERENCES faturalar(id) ON DELETE SET NULL,
  ADD COLUMN kur_farki_kapandi BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT fatura_kapamalari_capraz_tutar CHECK (
    (kaynak_tutari IS NULL AND kaynak_tutari_try IS NULL)
    OR (kaynak_tutari > 0 AND kaynak_tutari_try > 0 AND otomatik = false)
  );
CREATE INDEX fatura_kapamalari_kur_farki_fatura_id_idx ON fatura_kapamalari (kur_farki_fatura_id) WHERE kur_farki_fatura_id IS NOT NULL;
