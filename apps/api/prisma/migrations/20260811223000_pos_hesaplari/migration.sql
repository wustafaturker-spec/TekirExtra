CREATE TABLE "pos_hesaplari" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "ad" TEXT NOT NULL,
  "saglayici" TEXT NOT NULL, "baglanti_id" UUID, "varsayilan_banka_hesap_id" UUID,
  "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY', "aktif" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pos_hesaplari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_hesaplari_baglanti_id_fkey" FOREIGN KEY ("baglanti_id") REFERENCES "baglantilar"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pos_hesaplari_varsayilan_banka_hesap_id_fkey" FOREIGN KEY ("varsayilan_banka_hesap_id") REFERENCES "banka_hesaplari"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
ALTER TABLE "kasa_banka_hareketleri" ADD COLUMN "pos_hesap_id" UUID;
ALTER TABLE "kasa_banka_hareketleri" ADD CONSTRAINT "kasa_banka_hareketleri_pos_hesap_id_fkey" FOREIGN KEY ("pos_hesap_id") REFERENCES "pos_hesaplari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "pos_hesaplari_tenant_id_ad_key" ON "pos_hesaplari"("tenant_id", "ad");
CREATE INDEX "pos_hesaplari_tenant_id_aktif_idx" ON "pos_hesaplari"("tenant_id", "aktif");
ALTER TABLE "pos_hesaplari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_hesaplari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_pos_hesaplari ON "pos_hesaplari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
