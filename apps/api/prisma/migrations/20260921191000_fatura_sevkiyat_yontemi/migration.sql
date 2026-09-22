-- EBLG-76: sevkiyatın nasıl belgelendiği üç yollu tek alana taşındı.
ALTER TABLE "faturalar" ADD COLUMN "sevkiyat_yontemi" TEXT;
ALTER TABLE "faturalar" ADD COLUMN "fiili_sevk_zamani" TIMESTAMP(3);

-- Önceki boolean işaret korunur: "fatura sevkten önce düzenlendi" demekti.
UPDATE "faturalar" SET "sevkiyat_yontemi" = 'fatura_once' WHERE "irsaliye_sonra" = true;
