CREATE TABLE "banka_baglanti_hesaplari" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "baglanti_id" UUID NOT NULL,
  "banka_hesap_id" UUID NOT NULL,
  "dis_hesap_id" TEXT NOT NULL,
  "son_hareket_id" TEXT,
  "son_senkron_tarihi" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "banka_baglanti_hesaplari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "banka_baglanti_hesaplari_baglanti_id_fkey" FOREIGN KEY ("baglanti_id") REFERENCES "baglantilar"("id") ON DELETE CASCADE,
  CONSTRAINT "banka_baglanti_hesaplari_banka_hesap_id_fkey" FOREIGN KEY ("banka_hesap_id") REFERENCES "banka_hesaplari"("id") ON DELETE CASCADE,
  CONSTRAINT "banka_baglanti_hesaplari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "banka_baglanti_hesaplari_baglanti_id_dis_hesap_id_key" ON "banka_baglanti_hesaplari"("baglanti_id", "dis_hesap_id");
CREATE UNIQUE INDEX "banka_baglanti_hesaplari_baglanti_id_banka_hesap_id_key" ON "banka_baglanti_hesaplari"("baglanti_id", "banka_hesap_id");
CREATE INDEX "banka_baglanti_hesaplari_tenant_id_baglanti_id_idx" ON "banka_baglanti_hesaplari"("tenant_id", "baglanti_id");
ALTER TABLE "banka_baglanti_hesaplari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "banka_baglanti_hesaplari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "banka_baglanti_hesaplari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
