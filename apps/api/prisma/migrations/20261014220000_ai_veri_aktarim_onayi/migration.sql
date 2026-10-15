ALTER TABLE "tenant_ai_ayarlari"
  ADD COLUMN "yurt_disi_onay_saglayici" TEXT,
  ADD COLUMN "yurt_disi_onay_model" TEXT,
  ADD COLUMN "yurt_disi_onay_politika" TEXT;

-- Legacy approvals lack provider/model/policy binding and are deliberately invalidated.
UPDATE "tenant_ai_ayarlari"
SET "yurt_disi_onay_at" = NULL, "yurt_disi_onay_user_id" = NULL
WHERE "yurt_disi_onay_at" IS NOT NULL;

CREATE TABLE "ai_veri_aktarim_onaylari" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "olay" VARCHAR(24) NOT NULL,
  "saglayici" VARCHAR(40) NOT NULL,
  "model" VARCHAR(120),
  "politika_surumu" VARCHAR(40) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_veri_aktarim_onaylari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_veri_aktarim_onaylari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ai_veri_aktarim_onaylari_tenant_id_created_at_idx" ON "ai_veri_aktarim_onaylari"("tenant_id", "created_at");
ALTER TABLE "ai_veri_aktarim_onaylari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_veri_aktarim_onaylari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_veri_aktarim_onaylari"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
