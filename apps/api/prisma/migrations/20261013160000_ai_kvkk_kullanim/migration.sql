-- AI-14: yurt dışı aktarım onayı; AI-15: günlük çağrı sınırı ve sayaç

ALTER TABLE "tenant_ai_ayarlari" ADD COLUMN "yurt_disi_onay_at" TIMESTAMP(3);
ALTER TABLE "tenant_ai_ayarlari" ADD COLUMN "yurt_disi_onay_user_id" UUID;
ALTER TABLE "tenant_ai_ayarlari" ADD COLUMN "gunluk_cagri_siniri" INTEGER NOT NULL DEFAULT 1000;

CREATE TABLE "ai_kullanim" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "gun" DATE NOT NULL,
    "user_id" UUID NOT NULL,
    "ozellik" TEXT NOT NULL,
    "cagri" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_kullanim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_kullanim_tenant_id_gun_user_id_ozellik_key" ON "ai_kullanim"("tenant_id", "gun", "user_id", "ozellik");
CREATE INDEX "ai_kullanim_tenant_id_gun_idx" ON "ai_kullanim"("tenant_id", "gun");
ALTER TABLE "ai_kullanim" ADD CONSTRAINT "ai_kullanim_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_kullanim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_kullanim" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_kullanim"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
