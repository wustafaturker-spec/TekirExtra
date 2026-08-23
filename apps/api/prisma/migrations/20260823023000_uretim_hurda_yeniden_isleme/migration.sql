ALTER TABLE "uretim_emirleri"
  ADD COLUMN "hurda_miktari" DECIMAL(15,3) NOT NULL DEFAULT 0,
  ADD COLUMN "yeniden_isleme_miktari" DECIMAL(15,3) NOT NULL DEFAULT 0;

ALTER TABLE "uretim_bildirimleri"
  ADD COLUMN "yeniden_isleme_miktari" DECIMAL(15,3) NOT NULL DEFAULT 0;
