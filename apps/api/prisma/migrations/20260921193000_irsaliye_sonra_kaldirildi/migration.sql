-- EBLG-76: boolean işaretin yerini üç yollu `sevkiyat_yontemi` aldı; veri bir
-- önceki migration'da taşındı (irsaliye_sonra = true → 'fatura_once').
-- Taşınmamış kayıt kalmadığından emin olunur, sonra kolon düşürülür.
UPDATE "faturalar" SET "sevkiyat_yontemi" = 'fatura_once'
WHERE "irsaliye_sonra" = true AND "sevkiyat_yontemi" IS NULL;

ALTER TABLE "faturalar" DROP COLUMN "irsaliye_sonra";
