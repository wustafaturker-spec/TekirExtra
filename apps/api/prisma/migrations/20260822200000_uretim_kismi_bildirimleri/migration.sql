CREATE TABLE "uretim_bildirimleri" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL,
  "uretim_emri_id" UUID NOT NULL, "idempotency_anahtari" TEXT NOT NULL,
  "uretilen_miktar" DECIMAL(15,3) NOT NULL, "hurda_miktari" DECIMAL(15,3) NOT NULL DEFAULT 0,
  "toplam_maliyet" DECIMAL(15,4) NOT NULL DEFAULT 0, "bildirim_tarihi" TIMESTAMP(3) NOT NULL,
  "aciklama" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uretim_bildirimleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uretim_bildirimleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "uretim_bildirimleri_uretim_emri_id_fkey" FOREIGN KEY ("uretim_emri_id") REFERENCES "uretim_emirleri"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "uretim_bildirimleri_tenant_id_idempotency_anahtari_key" ON "uretim_bildirimleri"("tenant_id", "idempotency_anahtari");
CREATE INDEX "uretim_bildirimleri_tenant_id_uretim_emri_id_bildirim_tarihi_idx" ON "uretim_bildirimleri"("tenant_id", "uretim_emri_id", "bildirim_tarihi");

CREATE TABLE "uretim_bildirimi_sarflari" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL,
  "uretim_bildirimi_id" UUID NOT NULL, "uretim_emri_kalem_id" UUID NOT NULL,
  "miktar" DECIMAL(15,3) NOT NULL, "birim_maliyet" DECIMAL(15,4) NOT NULL,
  CONSTRAINT "uretim_bildirimi_sarflari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uretim_bildirimi_sarflari_uretim_bildirimi_id_fkey" FOREIGN KEY ("uretim_bildirimi_id") REFERENCES "uretim_bildirimleri"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "uretim_bildirimi_sarflari_uretim_emri_kalem_id_fkey" FOREIGN KEY ("uretim_emri_kalem_id") REFERENCES "uretim_emri_kalemleri"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "uretim_bildirimi_sarflari_uretim_bildirimi_id_uretim_emri_kalem_id_key" ON "uretim_bildirimi_sarflari"("uretim_bildirimi_id", "uretim_emri_kalem_id");
CREATE INDEX "uretim_bildirimi_sarflari_tenant_id_uretim_emri_kalem_id_idx" ON "uretim_bildirimi_sarflari"("tenant_id", "uretim_emri_kalem_id");

ALTER TABLE "uretim_bildirimleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uretim_bildirimleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_uretim_bildirimleri" ON "uretim_bildirimleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "uretim_bildirimi_sarflari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uretim_bildirimi_sarflari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_uretim_bildirimi_sarflari" ON "uretim_bildirimi_sarflari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
