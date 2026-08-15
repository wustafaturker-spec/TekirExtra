CREATE TABLE "doviz_kurlari" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "tarih" DATE NOT NULL,
  "doviz_cinsi" "DovizCinsi" NOT NULL,
  "doviz_alis" DECIMAL(15,6) NOT NULL,
  "doviz_satis" DECIMAL(15,6) NOT NULL,
  "kaynak" TEXT NOT NULL DEFAULT 'TCMB_EVDS',
  "alindi_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "doviz_kurlari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "doviz_kurlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "doviz_kurlari_tenant_id_tarih_doviz_cinsi_key" ON "doviz_kurlari"("tenant_id", "tarih", "doviz_cinsi");
CREATE INDEX "doviz_kurlari_tenant_id_doviz_cinsi_tarih_idx" ON "doviz_kurlari"("tenant_id", "doviz_cinsi", "tarih");

ALTER TABLE "doviz_kurlari" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "doviz_kurlari_tenant_isolation" ON "doviz_kurlari"
USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
