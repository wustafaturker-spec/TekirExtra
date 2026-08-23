CREATE TYPE "UretimSarfDuzeltmeTip" AS ENUM ('ek_sarf', 'iade');
CREATE TABLE "uretim_sarf_duzeltmeleri" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL, "uretim_emri_id" UUID NOT NULL,
  "uretim_emri_kalem_id" UUID NOT NULL, "depo_id" UUID NOT NULL, "tip" "UretimSarfDuzeltmeTip" NOT NULL,
  "miktar" DECIMAL(15,3) NOT NULL, "birim_maliyet" DECIMAL(15,4) NOT NULL, "neden" TEXT NOT NULL,
  "idempotency_anahtari" TEXT NOT NULL, "parti_bilgileri" JSONB, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uretim_sarf_duzeltmeleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uretim_sarf_duzeltmeleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "uretim_sarf_duzeltmeleri_uretim_emri_id_fkey" FOREIGN KEY ("uretim_emri_id") REFERENCES "uretim_emirleri"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "uretim_sarf_duzeltmeleri_uretim_emri_kalem_id_fkey" FOREIGN KEY ("uretim_emri_kalem_id") REFERENCES "uretim_emri_kalemleri"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "uretim_sarf_duzeltmeleri_depo_id_fkey" FOREIGN KEY ("depo_id") REFERENCES "depolar"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "uretim_sarf_duzeltmeleri_tenant_id_idempotency_anahtari_key" ON "uretim_sarf_duzeltmeleri"("tenant_id", "idempotency_anahtari");
CREATE INDEX "uretim_sarf_duzeltmeleri_tenant_id_uretim_emri_id_created_at_idx" ON "uretim_sarf_duzeltmeleri"("tenant_id", "uretim_emri_id", "created_at");
ALTER TABLE "uretim_sarf_duzeltmeleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uretim_sarf_duzeltmeleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_uretim_sarf_duzeltmeleri" ON "uretim_sarf_duzeltmeleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
