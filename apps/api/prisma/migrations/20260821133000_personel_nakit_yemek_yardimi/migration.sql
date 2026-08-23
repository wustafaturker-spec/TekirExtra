ALTER TABLE "personel_donem_calismalari"
  ADD COLUMN "nakit_yemek_yardimi" DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN "fiili_calisma_gunu" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "personel_donem_calismalari"
  ADD CONSTRAINT "personel_donem_calismalari_yemek_yardimi_check"
  CHECK ("nakit_yemek_yardimi" >= 0 AND "fiili_calisma_gunu" BETWEEN 0 AND 31);
