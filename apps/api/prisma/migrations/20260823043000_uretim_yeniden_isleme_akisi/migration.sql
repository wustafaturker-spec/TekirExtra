ALTER TYPE "KaliteKontrolDurum" ADD VALUE IF NOT EXISTS 'yeniden_isleme' AFTER 'bekliyor';

ALTER TABLE "uretim_emri_kalemleri"
  ADD COLUMN "ek_ihtiyac_miktari" DECIMAL(15,3) NOT NULL DEFAULT 0;

ALTER TABLE "uretim_kalite_kontrolleri"
  ADD COLUMN "yeniden_isleme_sayisi" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "yeniden_isleme_baslangic" TIMESTAMP(3),
  ADD COLUMN "yeniden_isleme_bitis" TIMESTAMP(3);
