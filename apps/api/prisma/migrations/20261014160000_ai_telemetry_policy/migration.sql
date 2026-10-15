ALTER TABLE "tenant_ai_ayarlari"
  ADD COLUMN "telemetri_saklama_gun" INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN "telemetri_hata_esigi_yuzde" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "telemetri_gecikme_esigi_ms" INTEGER NOT NULL DEFAULT 10000;
