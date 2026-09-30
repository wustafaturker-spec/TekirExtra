-- Varyanta özel reçete: boşsa genel reçete (tüm varyantlar), doluysa yalnız o varyant.
ALTER TABLE "urun_receteleri" ADD COLUMN "varyant_id" UUID;
CREATE INDEX "urun_receteleri_tenant_id_stok_id_varyant_id_idx" ON "urun_receteleri"("tenant_id", "stok_id", "varyant_id");
ALTER TABLE "urun_receteleri" ADD CONSTRAINT "urun_receteleri_varyant_id_fkey" FOREIGN KEY ("varyant_id") REFERENCES "stok_varyantlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
