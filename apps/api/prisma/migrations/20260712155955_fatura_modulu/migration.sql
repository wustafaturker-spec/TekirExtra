-- CreateEnum
CREATE TYPE "BelgeDurum" AS ENUM ('kuyrukta', 'iletildi', 'kabul', 'ret', 'hata');

-- CreateEnum
CREATE TYPE "FaturaTip" AS ENUM ('satis', 'alis', 'satis_iade', 'alis_iade', 'proforma');

-- CreateEnum
CREATE TYPE "FaturaDurum" AS ENUM ('taslak', 'kesin', 'iptal');

-- CreateEnum
CREATE TYPE "EbelgeTur" AS ENUM ('efatura', 'earsiv');

-- CreateTable
CREATE TABLE "faturalar" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tip" "FaturaTip" NOT NULL,
    "durum" "FaturaDurum" NOT NULL DEFAULT 'taslak',
    "no" TEXT,
    "seri" TEXT,
    "sira" INTEGER,
    "tarih" DATE NOT NULL,
    "vade_tarihi" DATE,
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
    "toplam_tevkifat" DECIMAL(15,2) NOT NULL,
    "toplam_net_kdv" DECIMAL(15,2) NOT NULL,
    "genel_toplam" DECIMAL(15,2) NOT NULL,
    "aciklama" TEXT,
    "notlar" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faturalar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fatura_satirlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "fatura_id" UUID NOT NULL,
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

    CONSTRAINT "fatura_satirlari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fatura_serileri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "seri" TEXT NOT NULL,
    "yil" INTEGER NOT NULL,
    "son_sira" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "fatura_serileri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebelge_kayitlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "fatura_id" UUID NOT NULL,
    "tur" "EbelgeTur" NOT NULL,
    "durum" "BelgeDurum" NOT NULL DEFAULT 'kuyrukta',
    "entegrator_ref" TEXT,
    "hata_mesaji" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ebelge_kayitlari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebelge_arsiv" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ebelge_id" UUID NOT NULL,
    "xml_icirik" TEXT NOT NULL,
    "pdf_dosya_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ebelge_arsiv_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "faturalar_tenant_id_tarih_idx" ON "faturalar"("tenant_id", "tarih");

-- CreateIndex
CREATE UNIQUE INDEX "faturalar_tenant_id_seri_sira_key" ON "faturalar"("tenant_id", "seri", "sira");

-- CreateIndex
CREATE INDEX "fatura_satirlari_tenant_id_fatura_id_idx" ON "fatura_satirlari"("tenant_id", "fatura_id");

-- CreateIndex
CREATE UNIQUE INDEX "fatura_serileri_tenant_id_seri_yil_key" ON "fatura_serileri"("tenant_id", "seri", "yil");

-- CreateIndex
CREATE UNIQUE INDEX "ebelge_kayitlari_fatura_id_key" ON "ebelge_kayitlari"("fatura_id");

-- CreateIndex
CREATE UNIQUE INDEX "ebelge_arsiv_ebelge_id_key" ON "ebelge_arsiv"("ebelge_id");

-- AddForeignKey
ALTER TABLE "faturalar" ADD CONSTRAINT "faturalar_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fatura_satirlari" ADD CONSTRAINT "fatura_satirlari_fatura_id_fkey" FOREIGN KEY ("fatura_id") REFERENCES "faturalar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fatura_satirlari" ADD CONSTRAINT "fatura_satirlari_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebelge_kayitlari" ADD CONSTRAINT "ebelge_kayitlari_fatura_id_fkey" FOREIGN KEY ("fatura_id") REFERENCES "faturalar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebelge_arsiv" ADD CONSTRAINT "ebelge_arsiv_ebelge_id_fkey" FOREIGN KEY ("ebelge_id") REFERENCES "ebelge_kayitlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;
