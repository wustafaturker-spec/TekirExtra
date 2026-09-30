-- Varyantlı mamulde üretilecek varyant; mamul girişi bu varyantın stoğuna yapılır.
ALTER TABLE "uretim_emirleri" ADD COLUMN "varyant_id" UUID;
ALTER TABLE "uretim_emirleri" ADD CONSTRAINT "uretim_emirleri_varyant_id_fkey" FOREIGN KEY ("varyant_id") REFERENCES "stok_varyantlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "uretim_emirleri_tenant_id_varyant_id_idx" ON "uretim_emirleri"("tenant_id", "varyant_id");
