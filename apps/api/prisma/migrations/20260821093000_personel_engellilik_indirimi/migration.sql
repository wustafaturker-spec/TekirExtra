ALTER TABLE "personel" ADD COLUMN "engellilik_derecesi" INTEGER;
ALTER TABLE "personel" ADD CONSTRAINT "personel_engellilik_derecesi_check" CHECK ("engellilik_derecesi" IS NULL OR "engellilik_derecesi" BETWEEN 1 AND 3);
