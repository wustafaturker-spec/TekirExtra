-- CreateTable
CREATE TABLE "rapor_gorunumleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rapor_kod" TEXT NOT NULL,
    "ad" TEXT NOT NULL,
    "girdi" JSONB NOT NULL,
    "firma_geneli" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rapor_gorunumleri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rapor_gorunumleri_tenant_id_rapor_kod_idx" ON "rapor_gorunumleri"("tenant_id", "rapor_kod");

-- CreateIndex
CREATE UNIQUE INDEX "rapor_gorunumleri_tenant_id_user_id_rapor_kod_ad_key" ON "rapor_gorunumleri"("tenant_id", "user_id", "rapor_kod", "ad");

-- Kiracı yalıtımı (KLN-06)
ALTER TABLE rapor_gorunumleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE rapor_gorunumleri FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rapor_gorunumleri
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
