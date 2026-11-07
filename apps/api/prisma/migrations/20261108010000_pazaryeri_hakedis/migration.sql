-- PZR-13: pazaryeri hakedişi ve banka mutabakatı.
ALTER TYPE "EkstreEslesmeTuru" ADD VALUE IF NOT EXISTS 'pazaryeri_hakedis';
ALTER TYPE "PazaryeriKesintiDurumu" ADD VALUE IF NOT EXISTS 'hakediste_kaydedildi';

ALTER TABLE "baglantilar" ADD COLUMN "pazaryeri_cari_id" UUID;
ALTER TABLE "baglantilar" ADD CONSTRAINT "baglantilar_pazaryeri_cari_id_fkey" FOREIGN KEY ("pazaryeri_cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "pazaryeri_hakedisleri" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "baglanti_id" UUID NOT NULL,
  "ekstre_satir_id" UUID NOT NULL, "banka_hareket_id" UUID NOT NULL, "pazaryeri_cari_id" UUID NOT NULL,
  "tarih" DATE NOT NULL, "doviz_cinsi" VARCHAR(3) NOT NULL,
  "banka_tutari" DECIMAL(15,2) NOT NULL, "siparis_toplami" DECIMAL(15,2) NOT NULL, "kesinti_toplami" DECIMAL(15,2) NOT NULL,
  "stopaj_toplami" DECIMAL(15,2) NOT NULL, "fark" DECIMAL(15,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pazaryeri_hakedisleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pazaryeri_hakedisleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pazaryeri_hakedisleri_baglanti_id_fkey" FOREIGN KEY ("baglanti_id") REFERENCES "baglantilar"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pazaryeri_hakedisleri_ekstre_satir_id_fkey" FOREIGN KEY ("ekstre_satir_id") REFERENCES "banka_ekstre_satirlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pazaryeri_hakedisleri_banka_hareket_id_fkey" FOREIGN KEY ("banka_hareket_id") REFERENCES "kasa_banka_hareketleri"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pazaryeri_hakedisleri_pazaryeri_cari_id_fkey" FOREIGN KEY ("pazaryeri_cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "pazaryeri_hakedisleri_ekstre_satir_id_key" ON "pazaryeri_hakedisleri"("ekstre_satir_id");
CREATE UNIQUE INDEX "pazaryeri_hakedisleri_banka_hareket_id_key" ON "pazaryeri_hakedisleri"("banka_hareket_id");
CREATE INDEX "pazaryeri_hakedisleri_tenant_id_baglanti_id_tarih_idx" ON "pazaryeri_hakedisleri"("tenant_id", "baglanti_id", "tarih");
ALTER TABLE "pazaryeri_hakedisleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pazaryeri_hakedisleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_pazaryeri_hakedisleri ON "pazaryeri_hakedisleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "pazaryeri_siparisleri" ADD COLUMN "hakedis_id" UUID;
ALTER TABLE "pazaryeri_siparisleri" ADD CONSTRAINT "pazaryeri_siparisleri_hakedis_id_fkey" FOREIGN KEY ("hakedis_id") REFERENCES "pazaryeri_hakedisleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pazaryeri_kesintileri" ADD COLUMN "hakedis_id" UUID;
ALTER TABLE "pazaryeri_kesintileri" ADD CONSTRAINT "pazaryeri_kesintileri_hakedis_id_fkey" FOREIGN KEY ("hakedis_id") REFERENCES "pazaryeri_hakedisleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "pazaryeri_siparisleri_tenant_id_hakedis_id_idx" ON "pazaryeri_siparisleri"("tenant_id", "hakedis_id");
CREATE INDEX "pazaryeri_kesintileri_tenant_id_hakedis_id_idx" ON "pazaryeri_kesintileri"("tenant_id", "hakedis_id");

-- SEC-17: bağlı kayıtlar aynı kiracıda olmalı.
CREATE TRIGGER kbag_baglantilar_pazaryeri_cari_id_fkey AFTER INSERT OR UPDATE OF pazaryeri_cari_id, tenant_id ON "baglantilar"
  FOR EACH ROW WHEN (NEW.pazaryeri_cari_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('pazaryeri_cari_id', 'cari_hesaplar', 'id');
CREATE TRIGGER kbag_pazaryeri_hakedisleri_baglanti_id_fkey AFTER INSERT OR UPDATE OF baglanti_id, tenant_id ON "pazaryeri_hakedisleri"
  FOR EACH ROW WHEN (NEW.baglanti_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('baglanti_id', 'baglantilar', 'id');
CREATE TRIGGER kbag_pazaryeri_siparisleri_hakedis_id_fkey AFTER INSERT OR UPDATE OF hakedis_id, tenant_id ON "pazaryeri_siparisleri"
  FOR EACH ROW WHEN (NEW.hakedis_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('hakedis_id', 'pazaryeri_hakedisleri', 'id');
CREATE TRIGGER kbag_pazaryeri_kesintileri_hakedis_id_fkey AFTER INSERT OR UPDATE OF hakedis_id, tenant_id ON "pazaryeri_kesintileri"
  FOR EACH ROW WHEN (NEW.hakedis_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('hakedis_id', 'pazaryeri_hakedisleri', 'id');
CREATE TRIGGER kbag_pazaryeri_hakedisleri_ekstre_satir_id_fkey AFTER INSERT OR UPDATE OF ekstre_satir_id, tenant_id ON "pazaryeri_hakedisleri"
  FOR EACH ROW WHEN (NEW.ekstre_satir_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('ekstre_satir_id', 'banka_ekstre_satirlari', 'id');
CREATE TRIGGER kbag_pazaryeri_hakedisleri_banka_hareket_id_fkey AFTER INSERT OR UPDATE OF banka_hareket_id, tenant_id ON "pazaryeri_hakedisleri"
  FOR EACH ROW WHEN (NEW.banka_hareket_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('banka_hareket_id', 'kasa_banka_hareketleri', 'id');
CREATE TRIGGER kbag_pazaryeri_hakedisleri_pazaryeri_cari_id_fkey AFTER INSERT OR UPDATE OF pazaryeri_cari_id, tenant_id ON "pazaryeri_hakedisleri"
  FOR EACH ROW WHEN (NEW.pazaryeri_cari_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('pazaryeri_cari_id', 'cari_hesaplar', 'id');
