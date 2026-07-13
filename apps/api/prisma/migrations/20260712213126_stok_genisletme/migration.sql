-- CreateEnum
CREATE TYPE "SayimDurum" AS ENUM ('taslak', 'onaylandi');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StokHareketTip" ADD VALUE 'fire';
ALTER TYPE "StokHareketTip" ADD VALUE 'zayi';
ALTER TYPE "StokHareketTip" ADD VALUE 'numune';
ALTER TYPE "StokHareketTip" ADD VALUE 'promosyon';
ALTER TYPE "StokHareketTip" ADD VALUE 'acilis';

-- AlterEnum
ALTER TYPE "StokTip" ADD VALUE 'sarf';

-- AlterTable
ALTER TABLE "sayimlar" ADD COLUMN     "durum" "SayimDurum" NOT NULL DEFAULT 'taslak',
ADD COLUMN     "onay_zamani" TIMESTAMP(3),
ADD COLUMN     "onaylayan_user_id" UUID;

-- AlterTable
ALTER TABLE "stok_kartlari" ADD COLUMN     "aciklama" TEXT,
ADD COLUMN     "gtip_kodu" TEXT,
ADD COLUMN     "guvenlik_stogu" DECIMAL(15,3),
ADD COLUMN     "kisa_ad" TEXT,
ADD COLUMN     "maks_stok" DECIMAL(15,3),
ADD COLUMN     "marka" TEXT,
ADD COLUMN     "mensei" TEXT,
ADD COLUMN     "min_stok" DECIMAL(15,3),
ADD COLUMN     "model" TEXT,
ADD COLUMN     "tedarik_suresi_gun" INTEGER,
ADD COLUMN     "uretici_urun_kodu" TEXT;

-- CreateTable
CREATE TABLE "stok_barkodlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stok_id" UUID NOT NULL,
    "barkod" TEXT NOT NULL,
    "birim" TEXT,
    "satis_fiyati" DECIMAL(15,4),

    CONSTRAINT "stok_barkodlari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stok_tedarikcileri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stok_id" UUID NOT NULL,
    "cari_id" UUID NOT NULL,
    "tedarikci_urun_kodu" TEXT,
    "alis_fiyati" DECIMAL(15,4),
    "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
    "tedarik_suresi_gun" INTEGER,
    "varsayilan" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "stok_tedarikcileri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stok_barkodlari_tenant_id_stok_id_idx" ON "stok_barkodlari"("tenant_id", "stok_id");

-- CreateIndex
CREATE UNIQUE INDEX "stok_barkodlari_tenant_id_barkod_key" ON "stok_barkodlari"("tenant_id", "barkod");

-- CreateIndex
CREATE INDEX "stok_tedarikcileri_tenant_id_cari_id_idx" ON "stok_tedarikcileri"("tenant_id", "cari_id");

-- CreateIndex
CREATE UNIQUE INDEX "stok_tedarikcileri_tenant_id_stok_id_cari_id_key" ON "stok_tedarikcileri"("tenant_id", "stok_id", "cari_id");

-- AddForeignKey
ALTER TABLE "stok_barkodlari" ADD CONSTRAINT "stok_barkodlari_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stok_tedarikcileri" ADD CONSTRAINT "stok_tedarikcileri_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stok_tedarikcileri" ADD CONSTRAINT "stok_tedarikcileri_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mevcut sayımlar 3. aşamada anında işlenmişti; onaylanmış kabul edilir (STK-20).
UPDATE sayimlar SET durum = 'onaylandi';

-- Kiracı yalıtımı (KLN-06): yeni tablolar
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stok_barkodlari','stok_tedarikcileri'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t);
  END LOOP;
END
$$;
