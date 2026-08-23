CREATE TABLE "bordro_kabul_senaryolari" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "mevzuat_seti_id" UUID NOT NULL, "ad" TEXT NOT NULL,
  "girdiler" JSONB NOT NULL, "beklenen" JSONB NOT NULL, "tolerans" DECIMAL(8,2) NOT NULL DEFAULT 0.01,
  "son_sonuc" JSONB, "basarili" BOOLEAN, "son_calistiran_id" UUID, "son_calisma_tarihi" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bordro_kabul_senaryolari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bordro_kabul_senaryolari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bordro_kabul_senaryolari_mevzuat_seti_id_fkey" FOREIGN KEY ("mevzuat_seti_id") REFERENCES "bordro_mevzuat_setleri"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "bordro_kabul_senaryolari_tenant_id_mevzuat_seti_id_basarili_idx" ON "bordro_kabul_senaryolari"("tenant_id","mevzuat_seti_id","basarili");
ALTER TABLE "bordro_kabul_senaryolari" ENABLE ROW LEVEL SECURITY; ALTER TABLE "bordro_kabul_senaryolari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bordro_kabul_senaryolari" USING (tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK (tenant_id=current_setting('app.tenant_id',true)::uuid);
