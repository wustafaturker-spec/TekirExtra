-- CreateEnum
CREATE TYPE "CariTip" AS ENUM ('musteri', 'tedarikci', 'her_ikisi');

-- CreateEnum
CREATE TYPE "DovizCinsi" AS ENUM ('TRY', 'USD', 'EUR');

-- CreateEnum
CREATE TYPE "CariHareketTip" AS ENUM ('borc', 'alacak');

-- CreateEnum
CREATE TYPE "AdresTip" AS ENUM ('fatura', 'sevk');

-- CreateEnum
CREATE TYPE "StokTip" AS ENUM ('urun', 'hizmet');

-- CreateEnum
CREATE TYPE "StokHareketTip" AS ENUM ('giris', 'cikis', 'sayim_duzeltme');

-- CreateTable
CREATE TABLE "cari_hesaplar" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kod" TEXT NOT NULL,
    "unvan" TEXT NOT NULL,
    "tip" "CariTip" NOT NULL,
    "vkn_tckn" TEXT,
    "vergi_dairesi" TEXT,
    "eposta" TEXT,
    "telefon" TEXT,
    "iban" TEXT,
    "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
    "fiyat_listesi_id" UUID,
    "varsayilan_iskonto" DECIMAL(5,2),
    "varsayilan_vade_gun" INTEGER,
    "risk_limiti" DECIMAL(15,2),
    "e_fatura_mukellefi" BOOLEAN,
    "mukellefiyet_sorgu_zamani" TIMESTAMP(3),
    "notlar" TEXT,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cari_hesaplar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cari_adresler" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cari_id" UUID NOT NULL,
    "tip" "AdresTip" NOT NULL,
    "baslik" TEXT NOT NULL,
    "adres" TEXT NOT NULL,
    "il" TEXT,
    "ilce" TEXT,
    "ulke" TEXT NOT NULL DEFAULT 'TR',

    CONSTRAINT "cari_adresler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cari_kisiler" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cari_id" UUID NOT NULL,
    "ad_soyad" TEXT NOT NULL,
    "gorev" TEXT,
    "telefon" TEXT,
    "eposta" TEXT,

    CONSTRAINT "cari_kisiler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cari_hareketler" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cari_id" UUID NOT NULL,
    "tip" "CariHareketTip" NOT NULL,
    "tutar" DECIMAL(15,2) NOT NULL,
    "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
    "kur" DECIMAL(15,6) NOT NULL DEFAULT 1,
    "tutar_try" DECIMAL(15,2) NOT NULL,
    "tarih" DATE NOT NULL,
    "vade_tarihi" DATE,
    "aciklama" TEXT,
    "kaynak_tur" TEXT NOT NULL DEFAULT 'manuel',
    "kaynak_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cari_hareketler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stok_kategorileri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ad" TEXT NOT NULL,
    "ust_id" UUID,

    CONSTRAINT "stok_kategorileri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stok_kartlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kod" TEXT NOT NULL,
    "ad" TEXT NOT NULL,
    "tip" "StokTip" NOT NULL DEFAULT 'urun',
    "barkod" TEXT,
    "kategori_id" UUID,
    "ana_birim" TEXT NOT NULL DEFAULT 'adet',
    "kdv_orani" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "alis_fiyati" DECIMAL(15,4),
    "satis_fiyati" DECIMAL(15,4),
    "kritik_seviye" DECIMAL(15,3),
    "gorsel_url" TEXT,
    "mevcut_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "ortalama_maliyet" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stok_kartlari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stok_birimleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stok_id" UUID NOT NULL,
    "ad" TEXT NOT NULL,
    "katsayi" DECIMAL(15,6) NOT NULL,

    CONSTRAINT "stok_birimleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiyat_listeleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ad" TEXT NOT NULL,
    "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiyat_listeleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiyat_listesi_kalemleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "liste_id" UUID NOT NULL,
    "stok_id" UUID NOT NULL,
    "fiyat" DECIMAL(15,4) NOT NULL,

    CONSTRAINT "fiyat_listesi_kalemleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stok_hareketleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stok_id" UUID NOT NULL,
    "tip" "StokHareketTip" NOT NULL,
    "miktar" DECIMAL(15,3) NOT NULL,
    "girilen_birim" TEXT NOT NULL,
    "girilen_miktar" DECIMAL(15,3) NOT NULL,
    "maliyet" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "tarih" DATE NOT NULL,
    "aciklama" TEXT,
    "kaynak_tur" TEXT NOT NULL DEFAULT 'manuel',
    "kaynak_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stok_hareketleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sayimlar" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tarih" DATE NOT NULL,
    "aciklama" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sayimlar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sayim_kalemleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sayim_id" UUID NOT NULL,
    "stok_id" UUID NOT NULL,
    "sistem_miktar" DECIMAL(15,3) NOT NULL,
    "fiili_miktar" DECIMAL(15,3) NOT NULL,

    CONSTRAINT "sayim_kalemleri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cari_hesaplar_tenant_id_unvan_idx" ON "cari_hesaplar"("tenant_id", "unvan");

-- CreateIndex
CREATE UNIQUE INDEX "cari_hesaplar_tenant_id_kod_key" ON "cari_hesaplar"("tenant_id", "kod");

-- CreateIndex
CREATE INDEX "cari_adresler_tenant_id_cari_id_idx" ON "cari_adresler"("tenant_id", "cari_id");

-- CreateIndex
CREATE INDEX "cari_kisiler_tenant_id_cari_id_idx" ON "cari_kisiler"("tenant_id", "cari_id");

-- CreateIndex
CREATE INDEX "cari_hareketler_tenant_id_cari_id_tarih_idx" ON "cari_hareketler"("tenant_id", "cari_id", "tarih");

-- CreateIndex
CREATE INDEX "stok_kategorileri_tenant_id_idx" ON "stok_kategorileri"("tenant_id");

-- CreateIndex
CREATE INDEX "stok_kartlari_tenant_id_ad_idx" ON "stok_kartlari"("tenant_id", "ad");

-- CreateIndex
CREATE UNIQUE INDEX "stok_kartlari_tenant_id_kod_key" ON "stok_kartlari"("tenant_id", "kod");

-- CreateIndex
CREATE UNIQUE INDEX "stok_birimleri_tenant_id_stok_id_ad_key" ON "stok_birimleri"("tenant_id", "stok_id", "ad");

-- CreateIndex
CREATE UNIQUE INDEX "fiyat_listeleri_tenant_id_ad_key" ON "fiyat_listeleri"("tenant_id", "ad");

-- CreateIndex
CREATE UNIQUE INDEX "fiyat_listesi_kalemleri_tenant_id_liste_id_stok_id_key" ON "fiyat_listesi_kalemleri"("tenant_id", "liste_id", "stok_id");

-- CreateIndex
CREATE INDEX "stok_hareketleri_tenant_id_stok_id_tarih_idx" ON "stok_hareketleri"("tenant_id", "stok_id", "tarih");

-- AddForeignKey
ALTER TABLE "cari_hesaplar" ADD CONSTRAINT "cari_hesaplar_fiyat_listesi_id_fkey" FOREIGN KEY ("fiyat_listesi_id") REFERENCES "fiyat_listeleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cari_adresler" ADD CONSTRAINT "cari_adresler_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cari_kisiler" ADD CONSTRAINT "cari_kisiler_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cari_hareketler" ADD CONSTRAINT "cari_hareketler_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stok_kategorileri" ADD CONSTRAINT "stok_kategorileri_ust_id_fkey" FOREIGN KEY ("ust_id") REFERENCES "stok_kategorileri"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stok_kartlari" ADD CONSTRAINT "stok_kartlari_kategori_id_fkey" FOREIGN KEY ("kategori_id") REFERENCES "stok_kategorileri"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stok_birimleri" ADD CONSTRAINT "stok_birimleri_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiyat_listesi_kalemleri" ADD CONSTRAINT "fiyat_listesi_kalemleri_liste_id_fkey" FOREIGN KEY ("liste_id") REFERENCES "fiyat_listeleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiyat_listesi_kalemleri" ADD CONSTRAINT "fiyat_listesi_kalemleri_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stok_hareketleri" ADD CONSTRAINT "stok_hareketleri_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sayim_kalemleri" ADD CONSTRAINT "sayim_kalemleri_sayim_id_fkey" FOREIGN KEY ("sayim_id") REFERENCES "sayimlar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Kiracı yalıtımı: yeni tabloların tümünde RLS (MIMARI §3)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cari_hesaplar','cari_adresler','cari_kisiler','cari_hareketler',
    'stok_kategorileri','stok_kartlari','stok_birimleri',
    'fiyat_listeleri','fiyat_listesi_kalemleri','stok_hareketleri',
    'sayimlar','sayim_kalemleri'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t);
  END LOOP;
END
$$;

-- Cari ve stok hareketleri değişmez kayıttır (NFR-08 öncüsü):
-- düzeltme ters kayıtla yapılır, uygulama rolü UPDATE yapamaz.
REVOKE UPDATE ON TABLE cari_hareketler, stok_hareketleri FROM tekir_app;
