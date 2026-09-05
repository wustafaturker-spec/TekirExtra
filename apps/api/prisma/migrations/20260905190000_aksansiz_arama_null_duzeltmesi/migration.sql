-- ARA-01 düzeltmesi: `arama_normal` kayıtların çoğunda NULL kalıyordu.
--
-- `tekir_arama_normal` STRICT işaretlenmişti; STRICT bir fonksiyon NULL girdide
-- gövdesini hiç çalıştırmaz, doğrudan NULL döner — gövdedeki `coalesce` bu
-- yüzden devreye girmiyordu. Kolon ifadesi alanları `||` ile birleştirdiğinden
-- tek bir NULL alan (vkn/tckn'si veya telefonu olmayan bir cari, barkodsuz bir
-- stok kartı) satırın tamamını NULL yapıyordu: dev veritabanında 806 carinin
-- 448'i, 770 stok kartının 511'i aramada hiç görünmüyordu.
--
-- STRICT kaldırıldı. Saklanan (STORED) değerler yalnız yazma anında hesaplandığı
-- için fonksiyonu değiştirmek mevcut satırları düzeltmez; kolonlar düşürülüp
-- yeniden eklenerek tüm tablo için yeniden hesaplanır.
ALTER TABLE "cari_hesaplar" DROP COLUMN "arama_normal";
ALTER TABLE "stok_kartlari" DROP COLUMN "arama_normal";
ALTER TABLE "faturalar" DROP COLUMN "arama_normal";

CREATE OR REPLACE FUNCTION tekir_arama_normal(metin text)
RETURNS text AS $$
  SELECT unaccent('unaccent', lower(coalesce(metin, '')));
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

ALTER TABLE "cari_hesaplar" ADD COLUMN "arama_normal" TEXT
  GENERATED ALWAYS AS (
    tekir_arama_normal("unvan") || ' ' || tekir_arama_normal("kod") || ' ' ||
    tekir_arama_normal("vkn_tckn") || ' ' || tekir_arama_normal("telefon")
  ) STORED;

ALTER TABLE "stok_kartlari" ADD COLUMN "arama_normal" TEXT
  GENERATED ALWAYS AS (
    tekir_arama_normal("ad") || ' ' || tekir_arama_normal("kod") || ' ' || tekir_arama_normal("barkod")
  ) STORED;

ALTER TABLE "faturalar" ADD COLUMN "arama_normal" TEXT
  GENERATED ALWAYS AS (tekir_arama_normal("no")) STORED;

CREATE INDEX "cari_hesaplar_arama_normal_trgm_idx" ON "cari_hesaplar" USING GIN ("arama_normal" gin_trgm_ops);
CREATE INDEX "stok_kartlari_arama_normal_trgm_idx" ON "stok_kartlari" USING GIN ("arama_normal" gin_trgm_ops);
CREATE INDEX "faturalar_arama_normal_trgm_idx" ON "faturalar" USING GIN ("arama_normal" gin_trgm_ops);
