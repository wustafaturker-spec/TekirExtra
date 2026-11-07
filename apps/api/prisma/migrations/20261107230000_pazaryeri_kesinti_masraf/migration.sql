-- PZR-10: faturasız pazaryeri kesintisi (ceza, diğer) masraf kaydına dönüşür.
ALTER TYPE "PazaryeriKesintiDurumu" ADD VALUE IF NOT EXISTS 'masrafa_donustu';
ALTER TABLE "pazaryeri_kesintileri" ADD COLUMN "masraf_id" UUID;
ALTER TABLE "pazaryeri_kesintileri" ADD CONSTRAINT "pazaryeri_kesintileri_masraf_id_fkey" FOREIGN KEY ("masraf_id") REFERENCES "masraflar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "pazaryeri_kesintileri_masraf_id_key" ON "pazaryeri_kesintileri"("masraf_id");
-- SEC-17: masraf aynı kiracıda olmalı.
CREATE TRIGGER kbag_pazaryeri_kesintileri_masraf_id_fkey AFTER INSERT OR UPDATE OF masraf_id, tenant_id ON "pazaryeri_kesintileri"
  FOR EACH ROW WHEN (NEW.masraf_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('masraf_id', 'masraflar', 'id');
