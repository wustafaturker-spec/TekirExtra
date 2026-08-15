-- CreateEnum
CREATE TYPE "FiyatTipi" AS ENUM ('alis', 'satis');

-- CreateTable
CREATE TABLE "stok_fiyatlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stok_id" UUID NOT NULL,
    "varyant_id" UUID,
    "tip" "FiyatTipi" NOT NULL,
    "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
    "tutar" DECIMAL(15,4) NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stok_fiyatlari_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stok_fiyatlari_tenant_id_stok_id_tip_doviz_cinsi_idx" ON "stok_fiyatlari"("tenant_id", "stok_id", "tip", "doviz_cinsi");

-- CreateIndex
CREATE UNIQUE INDEX "stok_fiyatlari_tenant_id_stok_id_varyant_id_tip_doviz_cinsi_key" ON "stok_fiyatlari"("tenant_id", "stok_id", "varyant_id", "tip", "doviz_cinsi");

-- AddForeignKey
ALTER TABLE "stok_fiyatlari" ADD CONSTRAINT "stok_fiyatlari_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;
