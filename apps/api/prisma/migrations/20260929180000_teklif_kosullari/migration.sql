-- FTR-33: teklif koşulları (ödeme vadesi, teslim süresi, teslim şekli); zincirde faturaya taşınır.
ALTER TABLE "belgeler" ADD COLUMN "odeme_vade_gun" INTEGER;
ALTER TABLE "belgeler" ADD COLUMN "teslim_suresi" TEXT;
ALTER TABLE "belgeler" ADD COLUMN "teslim_sekli" TEXT;
