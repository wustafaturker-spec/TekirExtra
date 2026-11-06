CREATE TABLE "vergi_daireleri" (
  "kod" VARCHAR(10) NOT NULL,
  "il_kodu" VARCHAR(2) NOT NULL,
  "il" VARCHAR(80) NOT NULL,
  "ilce" VARCHAR(80) NOT NULL,
  "ad" VARCHAR(160) NOT NULL,
  "aktif" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "vergi_daireleri_pkey" PRIMARY KEY ("kod")
);
CREATE INDEX "vergi_daireleri_il_ilce_ad_idx" ON "vergi_daireleri"("il_kodu", "ilce", "ad");
GRANT SELECT ON "vergi_daireleri" TO tekir_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "vergi_daireleri" TO tekir_platform;
