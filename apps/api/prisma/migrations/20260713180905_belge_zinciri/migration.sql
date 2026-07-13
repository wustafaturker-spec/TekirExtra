-- CreateEnum
CREATE TYPE "BelgeTur" AS ENUM ('teklif', 'siparis', 'irsaliye');

-- CreateEnum
CREATE TYPE "BelgeYon" AS ENUM ('satis', 'alis');

-- CreateEnum
CREATE TYPE "ZincirBelgeDurum" AS ENUM ('taslak', 'onaylandi', 'kapandi', 'iptal');

-- AlterTable
ALTER TABLE "stok_kartlari" ADD COLUMN     "rezerve_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,
ADD COLUMN     "yoldaki_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "belgeler" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tur" "BelgeTur" NOT NULL,
    "yon" "BelgeYon" NOT NULL,
    "durum" "ZincirBelgeDurum" NOT NULL DEFAULT 'taslak',
    "no" TEXT,
    "tarih" DATE NOT NULL,
    "gecerlilik_tarihi" DATE,
    "cari_id" UUID NOT NULL,
    "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
    "kur" DECIMAL(15,6) NOT NULL DEFAULT 1,
    "genel_iskonto_yuzdesi" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "genel_iskonto_tutari" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "toplam_brut" DECIMAL(15,2) NOT NULL,
    "toplam_satir_iskontosu" DECIMAL(15,2) NOT NULL,
    "genel_iskonto_toplam" DECIMAL(15,2) NOT NULL,
    "toplam_matrah" DECIMAL(15,2) NOT NULL,
    "toplam_kdv" DECIMAL(15,2) NOT NULL,
    "toplam_tevkifat" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "toplam_net_kdv" DECIMAL(15,2) NOT NULL,
    "genel_toplam" DECIMAL(15,2) NOT NULL,
    "aciklama" TEXT,
    "notlar" TEXT,
    "kaynak_belge_id" UUID,
    "fatura_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "belgeler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "belge_satirlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "belge_id" UUID NOT NULL,
    "stok_id" UUID NOT NULL,
    "miktar" DECIMAL(15,3) NOT NULL,
    "birim" TEXT NOT NULL DEFAULT 'adet',
    "birim_fiyat" DECIMAL(15,4) NOT NULL,
    "iskonto_orani" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "iskonto_tutari" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "genel_iskonto_payi" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "matrah" DECIMAL(15,2) NOT NULL,
    "kdv_orani" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "kdv_tutari" DECIMAL(15,2) NOT NULL,
    "tevkifat_pay" INTEGER,
    "tevkifat_payda" INTEGER,
    "tevkifat_tutari" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "net_kdv_tutari" DECIMAL(15,2) NOT NULL,
    "toplam_tutar" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "belge_satirlari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "belge_sayaclari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tur" "BelgeTur" NOT NULL,
    "yil" INTEGER NOT NULL,
    "son_sira" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "belge_sayaclari_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "belgeler_tenant_id_tur_durum_idx" ON "belgeler"("tenant_id", "tur", "durum");

-- CreateIndex
CREATE INDEX "belgeler_tenant_id_cari_id_idx" ON "belgeler"("tenant_id", "cari_id");

-- CreateIndex
CREATE UNIQUE INDEX "belgeler_tenant_id_no_key" ON "belgeler"("tenant_id", "no");

-- CreateIndex
CREATE INDEX "belge_satirlari_tenant_id_belge_id_idx" ON "belge_satirlari"("tenant_id", "belge_id");

-- CreateIndex
CREATE UNIQUE INDEX "belge_sayaclari_tenant_id_tur_yil_key" ON "belge_sayaclari"("tenant_id", "tur", "yil");

-- AddForeignKey
ALTER TABLE "belgeler" ADD CONSTRAINT "belgeler_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "belgeler" ADD CONSTRAINT "belgeler_kaynak_belge_id_fkey" FOREIGN KEY ("kaynak_belge_id") REFERENCES "belgeler"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "belgeler" ADD CONSTRAINT "belgeler_fatura_id_fkey" FOREIGN KEY ("fatura_id") REFERENCES "faturalar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "belge_satirlari" ADD CONSTRAINT "belge_satirlari_belge_id_fkey" FOREIGN KEY ("belge_id") REFERENCES "belgeler"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "belge_satirlari" ADD CONSTRAINT "belge_satirlari_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Kiracı yalıtımı (KLN-06): belge zinciri tabloları
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['belgeler','belge_satirlari','belge_sayaclari'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t);
  END LOOP;
END
$$;
