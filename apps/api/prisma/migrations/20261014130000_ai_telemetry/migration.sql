CREATE TABLE "ai_cagri_izleri" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "ozellik" TEXT NOT NULL,
  "saglayici" TEXT NOT NULL,
  "model" TEXT,
  "islem" TEXT NOT NULL,
  "sure_ms" INTEGER NOT NULL,
  "basarili" BOOLEAN NOT NULL,
  "hata_sinifi" TEXT,
  "giris_token" INTEGER,
  "cikis_token" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_cagri_izleri_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_cagri_izleri_tenant_id_created_at_idx" ON "ai_cagri_izleri"("tenant_id", "created_at");
CREATE INDEX "ai_cagri_izleri_tenant_id_ozellik_saglayici_basarili_idx" ON "ai_cagri_izleri"("tenant_id", "ozellik", "saglayici", "basarili");
ALTER TABLE "ai_cagri_izleri" ADD CONSTRAINT "ai_cagri_izleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_cagri_izleri" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_cagri_izleri"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
