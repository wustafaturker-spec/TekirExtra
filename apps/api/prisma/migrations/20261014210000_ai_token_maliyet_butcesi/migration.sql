ALTER TABLE "tenant_ai_ayarlari"
  ADD COLUMN "giris_token_milyon_usd" DECIMAL(12,6),
  ADD COLUMN "cikis_token_milyon_usd" DECIMAL(12,6),
  ADD COLUMN "aylik_maliyet_butcesi_usd" DECIMAL(12,2);

ALTER TABLE "ai_cagri_izleri"
  ADD COLUMN "maliyet_usd" DECIMAL(12,8);
