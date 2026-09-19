-- İhraç kayıtlı satış (EBLG-60).
--
-- Satış faturasında işaretlenir: KDV hesaplanır ve belgede görünür ama
-- tahsil edilmez (net KDV sıfır, genel toplam matrah). Kod 701 ya da 702;
-- belge IHRACKAYITLI tipinde gider.

ALTER TABLE "faturalar" ADD COLUMN IF NOT EXISTS "ihrac_kayitli_kodu" TEXT;
