-- Satış faturası senaryoları (FTR-16…FTR-21).
--
-- FTR-11 tevkifat ve istisnayı hesaplama/PDF tarafında kapatmıştı; e-belge
-- tarafı eksikti. Bu göç, UBL'e doğru `InvoiceTypeCode` ve `ProfileID`
-- yazabilmek ve tevkifatı GİB koduyla taşıyabilmek için gereken alanları ekler.

-- Senaryo, FaturaTip'ten ayrı bir kümedir: tip iç sınıflandırmamız
-- (satis/alis/proforma), senaryo GİB'in InvoiceTypeCode değeridir.
CREATE TYPE "FaturaSenaryo" AS ENUM ('satis', 'iade', 'tevkifat', 'istisna');
CREATE TYPE "EfaturaProfili" AS ENUM ('temel', 'ticari');

ALTER TABLE "cari_hesaplar" ADD COLUMN "efatura_profili" "EfaturaProfili" NOT NULL DEFAULT 'temel';

ALTER TABLE "faturalar" ADD COLUMN "senaryo" "FaturaSenaryo" NOT NULL DEFAULT 'satis';
ALTER TABLE "faturalar" ADD COLUMN "efatura_profili" "EfaturaProfili" NOT NULL DEFAULT 'temel';

ALTER TABLE "fatura_satirlari" ADD COLUMN "tevkifat_kodu" TEXT;

-- Mevcut faturaların senaryosu geriye dönük türetilir: elde tevkifat kodu
-- olmadığından oran taşıyan satır tevkifat, sıfır KDV + istisna kodu taşıyan
-- satır istisna sayılır. İade tipleri kendi senaryosuna geçer.
UPDATE "faturalar" f SET "senaryo" = 'tevkifat'
WHERE EXISTS (
  SELECT 1 FROM "fatura_satirlari" s
  WHERE s."fatura_id" = f."id" AND s."tevkifat_pay" IS NOT NULL AND s."tevkifat_payda" IS NOT NULL
);

UPDATE "faturalar" f SET "senaryo" = 'istisna'
WHERE f."senaryo" = 'satis' AND EXISTS (
  SELECT 1 FROM "fatura_satirlari" s
  WHERE s."fatura_id" = f."id" AND s."kdv_orani" = 0 AND s."gib_istisna_kodu" IS NOT NULL
);

UPDATE "faturalar" SET "senaryo" = 'iade' WHERE "tip" IN ('satis_iade', 'alis_iade');
