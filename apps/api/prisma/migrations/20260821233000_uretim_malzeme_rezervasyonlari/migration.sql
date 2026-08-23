CREATE TABLE "uretim_malzeme_rezervasyonlari" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "uretim_emri_kalem_id" UUID NOT NULL,
  "depo_id" UUID NOT NULL,
  "rezerve_miktar" DECIMAL(15,3) NOT NULL,
  "sarf_edilen_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,
  "cozulen_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uretim_malzeme_rezervasyonlari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uretim_malzeme_rezervasyonlari_uretim_emri_kalem_id_fkey" FOREIGN KEY ("uretim_emri_kalem_id") REFERENCES "uretim_emri_kalemleri"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "uretim_malzeme_rezervasyonlari_depo_id_fkey" FOREIGN KEY ("depo_id") REFERENCES "depolar"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uretim_malzeme_rezervasyonlari_tenant_id_uretim_emri_kalem_id_depo_id_key"
ON "uretim_malzeme_rezervasyonlari"("tenant_id", "uretim_emri_kalem_id", "depo_id");
CREATE INDEX "uretim_malzeme_rezervasyonlari_tenant_id_depo_id_idx"
ON "uretim_malzeme_rezervasyonlari"("tenant_id", "depo_id");

ALTER TABLE "uretim_malzeme_rezervasyonlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uretim_malzeme_rezervasyonlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_uretim_malzeme_rezervasyonlari" ON "uretim_malzeme_rezervasyonlari"
USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
