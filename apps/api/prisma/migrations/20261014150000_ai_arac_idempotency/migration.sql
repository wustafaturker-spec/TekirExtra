CREATE TABLE "ai_arac_istekleri" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "kaynak" TEXT NOT NULL,
  "istek_anahtari" VARCHAR(100) NOT NULL,
  "arac" TEXT NOT NULL,
  "girdi_ozeti" VARCHAR(64) NOT NULL,
  "durum" TEXT NOT NULL DEFAULT 'calisiyor',
  "sonuc" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tamamlandi_at" TIMESTAMP(3),
  CONSTRAINT "ai_arac_istekleri_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_arac_istekleri_tenant_id_user_id_kaynak_istek_anahtari_key" ON "ai_arac_istekleri"("tenant_id", "user_id", "kaynak", "istek_anahtari");
CREATE INDEX "ai_arac_istekleri_tenant_id_created_at_idx" ON "ai_arac_istekleri"("tenant_id", "created_at");
ALTER TABLE "ai_arac_istekleri" ADD CONSTRAINT "ai_arac_istekleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_arac_istekleri" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_arac_istekleri"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
