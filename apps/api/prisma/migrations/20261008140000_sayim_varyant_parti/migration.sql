-- STK-30/31: sayım kalemi varyant ve parti (lot/seri) bazında.
ALTER TABLE "sayim_kalemleri" ADD COLUMN "varyant_id" UUID;
ALTER TABLE "sayim_kalemleri" ADD COLUMN "partiler" JSONB;
ALTER TABLE "sayim_kalemleri" ADD CONSTRAINT "sayim_kalemleri_varyant_id_fkey" FOREIGN KEY ("varyant_id") REFERENCES "stok_varyantlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
