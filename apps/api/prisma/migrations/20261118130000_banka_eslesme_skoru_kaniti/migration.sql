-- AlterTable
ALTER TABLE "banka_ekstre_satirlari" ADD COLUMN IF NOT EXISTS "eslesme_skoru" INTEGER,
ADD COLUMN IF NOT EXISTS "eslesme_kaniti" JSONB;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "banka_ekstre_satirlari_tenant_id_eslesme_skoru_idx" ON "banka_ekstre_satirlari"("tenant_id", "eslesme_skoru");
