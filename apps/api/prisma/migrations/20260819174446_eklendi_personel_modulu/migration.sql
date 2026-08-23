-- CreateEnum
CREATE TYPE "PersonelCalismaTipi" AS ENUM ('tam_zamanli', 'yari_zamanli', 'sozlesmeli');

-- CreateTable
CREATE TABLE "personel" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ad" TEXT NOT NULL,
    "soyad" TEXT NOT NULL,
    "tckn" TEXT,
    "eposta" TEXT,
    "telefon" TEXT,
    "departman" TEXT,
    "unvan" TEXT,
    "calisma_tipi" "PersonelCalismaTipi" NOT NULL DEFAULT 'tam_zamanli',
    "giris_tarihi" DATE NOT NULL,
    "cikis_tarihi" DATE,
    "net_maas" DECIMAL(15,2) NOT NULL,
    "iban" TEXT,
    "cari_id" UUID,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personel_bordro" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "personel_id" UUID NOT NULL,
    "donem_yil" INTEGER NOT NULL,
    "donem_ay" INTEGER NOT NULL,
    "brut_maas" DECIMAL(15,2) NOT NULL,
    "net_maas" DECIMAL(15,2) NOT NULL,
    "prim" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "kesinti" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "odenecek_tutar" DECIMAL(15,2) NOT NULL,
    "odendi" BOOLEAN NOT NULL DEFAULT false,
    "odeme_tarihi" TIMESTAMP(3),
    "kasa_banka_fis_id" UUID,

    CONSTRAINT "personel_bordro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personel_avans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "personel_id" UUID NOT NULL,
    "tutar" DECIMAL(15,2) NOT NULL,
    "tarih" DATE NOT NULL,
    "aciklama" TEXT,
    "odendi" BOOLEAN NOT NULL DEFAULT false,
    "kasa_banka_fis_id" UUID,

    CONSTRAINT "personel_avans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "personel_cari_id_key" ON "personel"("cari_id");

-- CreateIndex
CREATE INDEX "personel_tenant_id_ad_soyad_idx" ON "personel"("tenant_id", "ad", "soyad");

-- CreateIndex
CREATE INDEX "personel_bordro_tenant_id_donem_yil_donem_ay_idx" ON "personel_bordro"("tenant_id", "donem_yil", "donem_ay");

-- CreateIndex
CREATE UNIQUE INDEX "personel_bordro_tenant_id_personel_id_donem_yil_donem_ay_key" ON "personel_bordro"("tenant_id", "personel_id", "donem_yil", "donem_ay");

-- CreateIndex
CREATE INDEX "personel_avans_tenant_id_personel_id_tarih_idx" ON "personel_avans"("tenant_id", "personel_id", "tarih");

-- AddForeignKey
ALTER TABLE "personel" ADD CONSTRAINT "personel_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personel" ADD CONSTRAINT "personel_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personel_bordro" ADD CONSTRAINT "personel_bordro_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personel_bordro" ADD CONSTRAINT "personel_bordro_personel_id_fkey" FOREIGN KEY ("personel_id") REFERENCES "personel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personel_avans" ADD CONSTRAINT "personel_avans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personel_avans" ADD CONSTRAINT "personel_avans_personel_id_fkey" FOREIGN KEY ("personel_id") REFERENCES "personel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "urun_recetesi_kalemleri_recete_id_malzeme_stok_id_malz_key" RENAME TO "urun_recetesi_kalemleri_recete_id_malzeme_stok_id_malzeme_v_key";
