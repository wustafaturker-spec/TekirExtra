CREATE TABLE IF NOT EXISTS "belge_kuyruk_isleri" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kullanici_id" UUID,
    "toplam_belge" INTEGER NOT NULL DEFAULT 0,
    "tamamlanan_belge" INTEGER NOT NULL DEFAULT 0,
    "hatali_belge" INTEGER NOT NULL DEFAULT 0,
    "durum" TEXT NOT NULL DEFAULT 'KUYRUKTA',
    "hata_mesaji" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tamamlandi_at" TIMESTAMP(3),

    CONSTRAINT "belge_kuyruk_isleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "belge_kuyruk_isleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "belge_kuyruk_isleri_tenant_id_created_at_idx" ON "belge_kuyruk_isleri"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "belge_kuyruk_isleri_tenant_id_durum_idx" ON "belge_kuyruk_isleri"("tenant_id", "durum");

ALTER TABLE "belge_kuyruk_isleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "belge_kuyruk_isleri" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "belge_kuyruk_isleri";
CREATE POLICY tenant_isolation ON "belge_kuyruk_isleri"
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "kuyruk_is_id" UUID;
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "dosya_adi" TEXT;
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "dosya_hash" VARCHAR(64);
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "sayfa_sayisi" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "dosya_boyutu" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "mime_tip" VARCHAR(100);
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "ek_id" UUID;
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "guven_puani" NUMERIC(5, 4);
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "alan_kanitlari" JSONB;
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "dogrulama_sonucu" JSONB;
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "kullanici_duzeltmesi" JSONB;
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "hata_mesaji" TEXT;
ALTER TABLE "belge_ocr_kayitlari" ADD COLUMN IF NOT EXISTS "mukerrer_aday_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'belge_ocr_kayitlari_kuyruk_is_id_fkey'
  ) THEN
    ALTER TABLE "belge_ocr_kayitlari" ADD CONSTRAINT "belge_ocr_kayitlari_kuyruk_is_id_fkey"
      FOREIGN KEY ("kuyruk_is_id") REFERENCES "belge_kuyruk_isleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "belge_ocr_kayitlari_tenant_id_dosya_hash_idx" ON "belge_ocr_kayitlari"("tenant_id", "dosya_hash");
CREATE INDEX IF NOT EXISTS "belge_ocr_kayitlari_tenant_id_kuyruk_is_id_idx" ON "belge_ocr_kayitlari"("tenant_id", "kuyruk_is_id");
