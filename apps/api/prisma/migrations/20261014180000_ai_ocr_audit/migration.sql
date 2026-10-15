CREATE TABLE "ai_ocr_denetimleri" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "mime_type" TEXT NOT NULL,
  "dosya_bayt" INTEGER NOT NULL,
  "genislik" INTEGER,
  "yukseklik" INTEGER,
  "saglayici" TEXT NOT NULL,
  "model" TEXT,
  "durum" TEXT NOT NULL DEFAULT 'calisiyor',
  "sure_ms" INTEGER,
  "hata_sinifi" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tamamlandi_at" TIMESTAMP(3),
  CONSTRAINT "ai_ocr_denetimleri_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_ocr_denetimleri_tenant_id_created_at_idx" ON "ai_ocr_denetimleri"("tenant_id", "created_at");
CREATE INDEX "ai_ocr_denetimleri_tenant_id_durum_created_at_idx" ON "ai_ocr_denetimleri"("tenant_id", "durum", "created_at");
ALTER TABLE "ai_ocr_denetimleri" ADD CONSTRAINT "ai_ocr_denetimleri_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_ocr_denetimleri" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_ocr_denetimleri"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
