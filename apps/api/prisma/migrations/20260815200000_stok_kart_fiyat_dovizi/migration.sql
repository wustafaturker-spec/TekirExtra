ALTER TABLE "stok_kartlari"
ADD COLUMN "alis_fiyati_doviz" "DovizCinsi" NOT NULL DEFAULT 'TRY',
ADD COLUMN "satis_fiyati_doviz" "DovizCinsi" NOT NULL DEFAULT 'TRY';
