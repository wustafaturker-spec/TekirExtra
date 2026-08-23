CREATE TABLE "uretim_donem_kilitleri" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "yil" INTEGER NOT NULL,
  "ay" INTEGER NOT NULL,
  "aciklama" TEXT,
  "kapatan_user_id" UUID NOT NULL,
  "kapatildi_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uretim_donem_kilitleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uretim_donem_kilitleri_ay_check" CHECK ("ay" BETWEEN 1 AND 12)
);
CREATE UNIQUE INDEX "uretim_donem_kilitleri_tenant_id_yil_ay_key" ON "uretim_donem_kilitleri"("tenant_id", "yil", "ay");
CREATE INDEX "uretim_donem_kilitleri_tenant_id_yil_ay_idx" ON "uretim_donem_kilitleri"("tenant_id", "yil", "ay");
ALTER TABLE "uretim_donem_kilitleri" ADD CONSTRAINT "uretim_donem_kilitleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "uretim_donem_kilitleri" ADD CONSTRAINT "uretim_donem_kilitleri_kapatan_user_id_fkey" FOREIGN KEY ("kapatan_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "uretim_emirleri" ADD COLUMN "satis_siparis_satir_id" UUID;
CREATE INDEX "uretim_emirleri_tenant_id_satis_siparis_satir_id_idx" ON "uretim_emirleri"("tenant_id", "satis_siparis_satir_id");
ALTER TABLE "uretim_emirleri" ADD CONSTRAINT "uretim_emirleri_satis_siparis_satir_id_fkey" FOREIGN KEY ("satis_siparis_satir_id") REFERENCES "belge_satirlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "uretim_donem_kilitleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uretim_donem_kilitleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "uretim_donem_kilitleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
