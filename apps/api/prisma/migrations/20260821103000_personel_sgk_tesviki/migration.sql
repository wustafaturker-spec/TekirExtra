ALTER TABLE "personel" ADD COLUMN "sgk_tesvik_orani" DECIMAL(6,3) NOT NULL DEFAULT 0;
ALTER TABLE "personel" ADD CONSTRAINT "personel_sgk_tesvik_orani_check" CHECK ("sgk_tesvik_orani" BETWEEN 0 AND 100);
ALTER TABLE "personel_donem_calismalari" ADD COLUMN "sgk_tesvik_orani" DECIMAL(6,3);
ALTER TABLE "personel_donem_calismalari" ADD CONSTRAINT "personel_donem_sgk_tesvik_orani_check" CHECK ("sgk_tesvik_orani" IS NULL OR "sgk_tesvik_orani" BETWEEN 0 AND 100);
