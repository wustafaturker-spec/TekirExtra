ALTER TYPE "UretimEmriDurum" ADD VALUE IF NOT EXISTS 'kalite_bekliyor' AFTER 'kismen_tamamlandi';
CREATE TYPE "KaliteKontrolDurum" AS ENUM ('bekliyor', 'kabul', 'red');
ALTER TABLE "urun_receteleri" ADD COLUMN "kalite_kontrol_gerekli" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "uretim_emirleri" ADD COLUMN "kalite_kontrol_gerekli" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "uretim_kalite_kontrolleri" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL, "uretim_emri_id" UUID NOT NULL,
  "uretim_bildirimi_id" UUID NOT NULL, "karantina_depo_id" UUID NOT NULL, "miktar" DECIMAL(15,3) NOT NULL,
  "durum" "KaliteKontrolDurum" NOT NULL DEFAULT 'bekliyor', "kontrol_notu" TEXT, "olcumler" JSONB,
  "kontrol_eden_user_id" UUID, "kontrol_zamani" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uretim_kalite_kontrolleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uretim_kalite_kontrolleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "uretim_kalite_kontrolleri_uretim_emri_id_fkey" FOREIGN KEY ("uretim_emri_id") REFERENCES "uretim_emirleri"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "uretim_kalite_kontrolleri_uretim_bildirimi_id_fkey" FOREIGN KEY ("uretim_bildirimi_id") REFERENCES "uretim_bildirimleri"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "uretim_kalite_kontrolleri_karantina_depo_id_fkey" FOREIGN KEY ("karantina_depo_id") REFERENCES "depolar"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "uretim_kalite_kontrolleri_uretim_bildirimi_id_key" ON "uretim_kalite_kontrolleri"("uretim_bildirimi_id");
CREATE INDEX "uretim_kalite_kontrolleri_tenant_id_durum_created_at_idx" ON "uretim_kalite_kontrolleri"("tenant_id", "durum", "created_at");
CREATE INDEX "uretim_kalite_kontrolleri_tenant_id_uretim_emri_id_idx" ON "uretim_kalite_kontrolleri"("tenant_id", "uretim_emri_id");
ALTER TABLE "uretim_kalite_kontrolleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uretim_kalite_kontrolleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_uretim_kalite_kontrolleri" ON "uretim_kalite_kontrolleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
