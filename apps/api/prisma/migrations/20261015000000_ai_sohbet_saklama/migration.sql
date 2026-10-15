-- Null keeps conversation cleanup disabled until a manager chooses a period.
ALTER TABLE "tenant_ai_ayarlari" ADD COLUMN "sohbet_saklama_gun" INTEGER;
ALTER TABLE "tenant_ai_ayarlari" ADD CONSTRAINT "tenant_ai_sohbet_saklama_gun_check"
  CHECK ("sohbet_saklama_gun" IS NULL OR "sohbet_saklama_gun" BETWEEN 7 AND 365);
