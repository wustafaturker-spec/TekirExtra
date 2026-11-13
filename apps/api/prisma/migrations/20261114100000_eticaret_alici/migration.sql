-- ETC-05: e-ticaret sitesi siparişinde bireysel alıcı bağlantının varsayılan carisine faturalanır;
-- asıl alıcı faturada nihai tüketici olarak tutulur (e-Arşiv müşterisi). Yalnız sütun eklenir.
ALTER TABLE "baglantilar" ADD COLUMN IF NOT EXISTS "varsayilan_alici_cari_id" UUID;
DO $$ BEGIN
  ALTER TABLE "baglantilar" ADD CONSTRAINT "baglantilar_varsayilan_alici_cari_id_fkey" FOREIGN KEY ("varsayilan_alici_cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- SEC-17: varsayılan alıcı carisi aynı kiracıda olmalı.
DROP TRIGGER IF EXISTS kbag_baglantilar_varsayilan_alici_cari_id_fkey ON "baglantilar";
CREATE TRIGGER kbag_baglantilar_varsayilan_alici_cari_id_fkey AFTER INSERT OR UPDATE OF varsayilan_alici_cari_id, tenant_id ON "baglantilar"
  FOR EACH ROW WHEN (NEW.varsayilan_alici_cari_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('varsayilan_alici_cari_id', 'cari_hesaplar', 'id');

ALTER TABLE "faturalar" ADD COLUMN IF NOT EXISTS "nihai_alici_ad_soyad" TEXT;
ALTER TABLE "faturalar" ADD COLUMN IF NOT EXISTS "nihai_alici_tckn" VARCHAR(11);
ALTER TABLE "faturalar" ADD COLUMN IF NOT EXISTS "nihai_alici_adres" TEXT;
ALTER TABLE "faturalar" ADD COLUMN IF NOT EXISTS "nihai_alici_il" TEXT;
ALTER TABLE "faturalar" ADD COLUMN IF NOT EXISTS "nihai_alici_ilce" TEXT;
ALTER TABLE "faturalar" ADD COLUMN IF NOT EXISTS "nihai_alici_posta_kodu" TEXT;
ALTER TABLE "faturalar" ADD COLUMN IF NOT EXISTS "nihai_alici_eposta" TEXT;
