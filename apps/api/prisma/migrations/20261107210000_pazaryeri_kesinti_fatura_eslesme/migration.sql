-- PZR-07: kesinti ↔ pazaryeri komisyon e-Faturası eşleştirmesi.
ALTER TABLE "baglantilar" ADD COLUMN "fatura_kesen_vkn" VARCHAR(11);
ALTER TABLE "pazaryeri_kesintileri" ADD COLUMN "gelen_ebelge_id" UUID;
ALTER TABLE "pazaryeri_kesintileri" ADD CONSTRAINT "pazaryeri_kesintileri_gelen_ebelge_id_fkey" FOREIGN KEY ("gelen_ebelge_id") REFERENCES "gelen_ebelgeler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "pazaryeri_kesintileri_tenant_id_gelen_ebelge_id_idx" ON "pazaryeri_kesintileri"("tenant_id", "gelen_ebelge_id");
-- SEC-17: eşleşilen fatura aynı kiracıda olmalı.
CREATE TRIGGER kbag_pazaryeri_kesintileri_gelen_ebelge_id_fkey AFTER INSERT OR UPDATE OF gelen_ebelge_id, tenant_id ON "pazaryeri_kesintileri"
  FOR EACH ROW WHEN (NEW.gelen_ebelge_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('gelen_ebelge_id', 'gelen_ebelgeler', 'id');
