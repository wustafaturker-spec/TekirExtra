-- CARI-41: holding / ana firma grubu ve grup risk limiti.

CREATE TABLE "cari_gruplari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ad" TEXT NOT NULL,
    "risk_limiti" DECIMAL(15,2),
    "notlar" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cari_gruplari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cari_gruplari_risk_limiti_check" CHECK ("risk_limiti" IS NULL OR "risk_limiti" >= 0)
);
CREATE UNIQUE INDEX "cari_gruplari_tenant_id_ad_key" ON "cari_gruplari"("tenant_id", "ad");
ALTER TABLE "cari_gruplari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cari_gruplari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cari_gruplari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "cari_hesaplar" ADD COLUMN "grup_id" UUID;
ALTER TABLE "cari_hesaplar" ADD CONSTRAINT "cari_hesaplar_grup_id_fkey" FOREIGN KEY ("grup_id") REFERENCES "cari_gruplari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "cari_hesaplar_tenant_id_grup_id_idx" ON "cari_hesaplar"("tenant_id", "grup_id");
