-- PZR-08: bağlantı başına kesinti türü → sınıf kuralı (kullanıcı seçer, kalıcı).
CREATE TABLE "pazaryeri_kesinti_kurallari" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "baglanti_id" UUID NOT NULL,
  "tur" TEXT NOT NULL, "sinif" "PazaryeriKesintiSinifi" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pazaryeri_kesinti_kurallari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pazaryeri_kesinti_kurallari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pazaryeri_kesinti_kurallari_baglanti_id_fkey" FOREIGN KEY ("baglanti_id") REFERENCES "baglantilar"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "pazaryeri_kesinti_kurallari_tenant_id_baglanti_id_tur_key" ON "pazaryeri_kesinti_kurallari"("tenant_id", "baglanti_id", "tur");
ALTER TABLE "pazaryeri_kesinti_kurallari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pazaryeri_kesinti_kurallari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_pazaryeri_kesinti_kurallari ON "pazaryeri_kesinti_kurallari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
-- SEC-17: bağlantı aynı kiracıda olmalı (20261103090000 ile aynı ad ve kural).
CREATE TRIGGER kbag_pazaryeri_kesinti_kurallari_baglanti_id_fkey AFTER INSERT OR UPDATE OF baglanti_id, tenant_id ON "pazaryeri_kesinti_kurallari"
  FOR EACH ROW WHEN (NEW.baglanti_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('baglanti_id', 'baglantilar', 'id');
