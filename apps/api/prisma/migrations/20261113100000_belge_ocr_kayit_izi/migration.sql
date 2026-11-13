-- AI-13: her tarama denetim izine yazılır: kim, hangi sağlayıcı/model, çıkarılan veri ve oluşan kayıtlar.
-- Tablo boştu; yalnız sütun eklenir, dosya yolu artık zorunlu değil (görsel taramada saklanmaz).
ALTER TABLE "belge_ocr_kayitlari" ALTER COLUMN "dosya_yolu" DROP NOT NULL;
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "kullanici_id" UUID;
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "kanal" TEXT;
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "saglayici" TEXT;
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "model" TEXT;
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "olusan_kayitlar" JSONB;
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "islendi_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "belge_ocr_kayitlari_tenant_id_created_at_idx" ON "belge_ocr_kayitlari"("tenant_id", "created_at");
