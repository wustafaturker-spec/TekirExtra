-- FTR-40: ticari belgelerin basım dili (tek dil ya da Türkçe + seçilen dil).
ALTER TABLE belgeler ADD COLUMN belge_dili TEXT NOT NULL DEFAULT 'tr',
  ADD COLUMN cift_dil BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT belgeler_belge_dili_check CHECK (belge_dili IN ('tr','en','de','ar','ru'));
ALTER TABLE faturalar ADD COLUMN belge_dili TEXT NOT NULL DEFAULT 'tr',
  ADD COLUMN cift_dil BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT faturalar_belge_dili_check CHECK (belge_dili IN ('tr','en','de','ar','ru'));
-- Cari kartında varsayılan dil; boş = Türkçe.
ALTER TABLE cari_hesaplar ADD COLUMN belge_dili TEXT,
  ADD COLUMN belge_cift_dil BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT cari_hesaplar_belge_dili_check CHECK (belge_dili IS NULL OR belge_dili IN ('tr','en','de','ar','ru'));
-- STK-41: dil başına ürün adı ve açıklaması.
ALTER TABLE stok_kartlari ADD COLUMN yabanci_adlar JSONB;
-- FTR-42: imza alanına basılan kaşe/imza görseli firma ekidir.
ALTER TYPE "EkSahipTur" ADD VALUE IF NOT EXISTS 'firma_kase';
