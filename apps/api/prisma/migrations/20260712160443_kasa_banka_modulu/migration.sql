-- CreateEnum
CREATE TYPE "KasaBankaHareketTip" AS ENUM ('tahsilat', 'tediye', 'virman_gidis', 'virman_gelis');

-- CreateEnum
CREATE TYPE "CekSenetTur" AS ENUM ('cek', 'senet');

-- CreateEnum
CREATE TYPE "CekSenetDurum" AS ENUM ('portfoyde', 'ciro_edildi', 'tahsil_edildi', 'karsiliksiz', 'iade_edildi');

-- CreateTable
CREATE TABLE "kasalar" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ad" TEXT NOT NULL,
    "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kasalar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banka_hesaplari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ad" TEXT NOT NULL,
    "banka_adi" TEXT NOT NULL,
    "sube" TEXT,
    "hesap_no" TEXT,
    "iban" TEXT,
    "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banka_hesaplari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kasa_banka_hareketleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kasa_id" UUID,
    "banka_hesap_id" UUID,
    "tip" "KasaBankaHareketTip" NOT NULL,
    "tutar" DECIMAL(15,2) NOT NULL,
    "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
    "kur" DECIMAL(15,6) NOT NULL DEFAULT 1,
    "tutar_try" DECIMAL(15,2) NOT NULL,
    "tarih" DATE NOT NULL,
    "aciklama" TEXT,
    "cari_id" UUID,
    "fatura_id" UUID,
    "karsi_hareket_id" UUID,
    "kaynak_tur" TEXT NOT NULL DEFAULT 'manuel',
    "kaynak_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kasa_banka_hareketleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cek_senetler" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tur" "CekSenetTur" NOT NULL,
    "portfoy_no" TEXT NOT NULL,
    "vade_tarihi" DATE NOT NULL,
    "tutar" DECIMAL(15,2) NOT NULL,
    "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
    "kur" DECIMAL(15,6) NOT NULL DEFAULT 1,
    "tutar_try" DECIMAL(15,2) NOT NULL,
    "borclu" TEXT NOT NULL,
    "keside_yeri" TEXT,
    "banka" TEXT,
    "sube" TEXT,
    "hesap_no" TEXT,
    "durum" "CekSenetDurum" NOT NULL DEFAULT 'portfoyde',
    "cari_id" UUID,
    "ciro_cari_id" UUID,
    "aciklama" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cek_senetler_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kasalar_tenant_id_ad_key" ON "kasalar"("tenant_id", "ad");

-- CreateIndex
CREATE UNIQUE INDEX "banka_hesaplari_tenant_id_ad_key" ON "banka_hesaplari"("tenant_id", "ad");

-- CreateIndex
CREATE INDEX "kasa_banka_hareketleri_tenant_id_tarih_idx" ON "kasa_banka_hareketleri"("tenant_id", "tarih");

-- CreateIndex
CREATE UNIQUE INDEX "cek_senetler_tenant_id_portfoy_no_key" ON "cek_senetler"("tenant_id", "portfoy_no");

-- AddForeignKey
ALTER TABLE "kasa_banka_hareketleri" ADD CONSTRAINT "kasa_banka_hareketleri_kasa_id_fkey" FOREIGN KEY ("kasa_id") REFERENCES "kasalar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kasa_banka_hareketleri" ADD CONSTRAINT "kasa_banka_hareketleri_banka_hesap_id_fkey" FOREIGN KEY ("banka_hesap_id") REFERENCES "banka_hesaplari"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kasa_banka_hareketleri" ADD CONSTRAINT "kasa_banka_hareketleri_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kasa_banka_hareketleri" ADD CONSTRAINT "kasa_banka_hareketleri_fatura_id_fkey" FOREIGN KEY ("fatura_id") REFERENCES "faturalar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cek_senetler" ADD CONSTRAINT "cek_senetler_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cek_senetler" ADD CONSTRAINT "cek_senetler_ciro_cari_id_fkey" FOREIGN KEY ("ciro_cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
