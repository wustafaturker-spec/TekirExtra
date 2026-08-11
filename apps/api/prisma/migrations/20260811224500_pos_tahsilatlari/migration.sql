CREATE TYPE "PosTahsilatDurumu" AS ENUM ('baslatildi', 'odendi', 'basarisiz');
CREATE TABLE "pos_tahsilatlari" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "pos_hesap_id" UUID NOT NULL,
  "cari_id" UUID NOT NULL, "fatura_id" UUID, "tutar" DECIMAL(15,2) NOT NULL,
  "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY', "durum" "PosTahsilatDurumu" NOT NULL DEFAULT 'baslatildi',
  "saglayici_token" TEXT, "saglayici_odeme_id" TEXT, "odeme_sayfasi_url" TEXT,
  "hareket_id" UUID, "hata_mesaji" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "pos_tahsilatlari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_tahsilatlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_tahsilatlari_pos_hesap_id_fkey" FOREIGN KEY ("pos_hesap_id") REFERENCES "pos_hesaplari"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pos_tahsilatlari_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pos_tahsilatlari_fatura_id_fkey" FOREIGN KEY ("fatura_id") REFERENCES "faturalar"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pos_tahsilatlari_hareket_id_fkey" FOREIGN KEY ("hareket_id") REFERENCES "kasa_banka_hareketleri"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "pos_tahsilatlari_saglayici_token_key" ON "pos_tahsilatlari"("saglayici_token");
CREATE UNIQUE INDEX "pos_tahsilatlari_hareket_id_key" ON "pos_tahsilatlari"("hareket_id");
CREATE INDEX "pos_tahsilatlari_tenant_id_durum_created_at_idx" ON "pos_tahsilatlari"("tenant_id", "durum", "created_at");
ALTER TABLE "pos_tahsilatlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_tahsilatlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_pos_tahsilatlari ON "pos_tahsilatlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
