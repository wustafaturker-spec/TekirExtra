-- Satın alma talep ve onay (SAT-01…SAT-08).
--
-- Talep → onay → teklif → alış siparişi. Onay tutar eşiği + rol ile verilir,
-- talep eden kendi talebini onaylayamaz; bütçe aşımı gerekçeyle onaylanır.
-- Olay geçmişi yalnız eklenir. Bütün tablolar kiracıya göre yalıtılır.

-- CreateEnum
CREATE TYPE "SatinAlmaTalepDurumu" AS ENUM ('taslak', 'onay_bekliyor', 'onaylandi', 'reddedildi', 'siparise_donustu', 'iptal');

-- CreateEnum
CREATE TYPE "SatinAlmaOlayTuru" AS ENUM ('olusturuldu', 'guncellendi', 'onaya_gonderildi', 'geri_cekildi', 'onaylandi', 'reddedildi', 'iptal_edildi', 'teklif_eklendi', 'teklif_silindi', 'teklif_secildi', 'siparise_donustu');

-- SAT-07: onay bekleyen talep bildirimi.
ALTER TYPE "BildirimTuru" ADD VALUE 'satin_alma';

-- SAT-05: teklif belgesi eki.
ALTER TYPE "EkSahipTur" ADD VALUE 'satin_alma_teklif';

-- CreateTable
CREATE TABLE "satin_alma_talepleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "no" TEXT NOT NULL,
    "talep_eden_user_id" UUID NOT NULL,
    "departman_id" UUID,
    "ihtiyac_tarihi" DATE NOT NULL,
    "gerekce" TEXT NOT NULL,
    "butce_anahtari" TEXT NOT NULL,
    "durum" "SatinAlmaTalepDurumu" NOT NULL DEFAULT 'taslak',
    "tahmini_toplam" DECIMAL(15,2) NOT NULL,
    "onaylayan_user_id" UUID,
    "onay_zamani" TIMESTAMP(3),
    "butce_asim_gerekcesi" TEXT,
    "red_gerekcesi" TEXT,
    "teklif_secim_gerekcesi" TEXT,
    "siparis_belge_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "satin_alma_talepleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "satin_alma_talep_kalemleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "talep_id" UUID NOT NULL,
    "sira" INTEGER NOT NULL,
    "stok_id" UUID NOT NULL,
    "miktar" DECIMAL(15,3) NOT NULL,
    "birim" TEXT NOT NULL,
    "tahmini_birim_fiyat" DECIMAL(15,4) NOT NULL,

    CONSTRAINT "satin_alma_talep_kalemleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "satin_alma_teklifleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "talep_id" UUID NOT NULL,
    "tedarikci_cari_id" UUID NOT NULL,
    "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
    "kur" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "teslim_suresi_gun" INTEGER,
    "gecerlilik_tarihi" DATE,
    "aciklama" TEXT,
    "toplam" DECIMAL(15,2) NOT NULL,
    "toplam_try" DECIMAL(15,2) NOT NULL,
    "secildi" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "satin_alma_teklifleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "satin_alma_teklif_kalemleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "teklif_id" UUID NOT NULL,
    "talep_kalemi_id" UUID NOT NULL,
    "birim_fiyat" DECIMAL(15,4) NOT NULL,
    "kdv_orani" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "satin_alma_teklif_kalemleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "satin_alma_talep_olaylari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "talep_id" UUID NOT NULL,
    "tur" "SatinAlmaOlayTuru" NOT NULL,
    "aciklama" TEXT,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "satin_alma_talep_olaylari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "satin_alma_sayaclari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "yil" INTEGER NOT NULL,
    "son_sira" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "satin_alma_sayaclari_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "satin_alma_talepleri_siparis_belge_id_key" ON "satin_alma_talepleri"("siparis_belge_id");
CREATE INDEX "satin_alma_talepleri_tenant_id_durum_idx" ON "satin_alma_talepleri"("tenant_id", "durum");
CREATE INDEX "satin_alma_talepleri_tenant_id_talep_eden_user_id_idx" ON "satin_alma_talepleri"("tenant_id", "talep_eden_user_id");
CREATE UNIQUE INDEX "satin_alma_talepleri_tenant_id_no_key" ON "satin_alma_talepleri"("tenant_id", "no");
CREATE INDEX "satin_alma_talep_kalemleri_talep_id_idx" ON "satin_alma_talep_kalemleri"("talep_id");
CREATE INDEX "satin_alma_teklifleri_talep_id_idx" ON "satin_alma_teklifleri"("talep_id");
CREATE UNIQUE INDEX "satin_alma_teklif_kalemleri_teklif_id_talep_kalemi_id_key" ON "satin_alma_teklif_kalemleri"("teklif_id", "talep_kalemi_id");
CREATE INDEX "satin_alma_talep_olaylari_tenant_id_talep_id_created_at_idx" ON "satin_alma_talep_olaylari"("tenant_id", "talep_id", "created_at");
CREATE UNIQUE INDEX "satin_alma_sayaclari_tenant_id_yil_key" ON "satin_alma_sayaclari"("tenant_id", "yil");

-- AddForeignKey
ALTER TABLE "satin_alma_talepleri" ADD CONSTRAINT "satin_alma_talepleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "satin_alma_talepleri" ADD CONSTRAINT "satin_alma_talepleri_talep_eden_user_id_fkey" FOREIGN KEY ("talep_eden_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "satin_alma_talepleri" ADD CONSTRAINT "satin_alma_talepleri_onaylayan_user_id_fkey" FOREIGN KEY ("onaylayan_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "satin_alma_talepleri" ADD CONSTRAINT "satin_alma_talepleri_departman_id_fkey" FOREIGN KEY ("departman_id") REFERENCES "personel_departmanlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "satin_alma_talepleri" ADD CONSTRAINT "satin_alma_talepleri_siparis_belge_id_fkey" FOREIGN KEY ("siparis_belge_id") REFERENCES "belgeler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "satin_alma_talep_kalemleri" ADD CONSTRAINT "satin_alma_talep_kalemleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "satin_alma_talep_kalemleri" ADD CONSTRAINT "satin_alma_talep_kalemleri_talep_id_fkey" FOREIGN KEY ("talep_id") REFERENCES "satin_alma_talepleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "satin_alma_talep_kalemleri" ADD CONSTRAINT "satin_alma_talep_kalemleri_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "satin_alma_teklifleri" ADD CONSTRAINT "satin_alma_teklifleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "satin_alma_teklifleri" ADD CONSTRAINT "satin_alma_teklifleri_talep_id_fkey" FOREIGN KEY ("talep_id") REFERENCES "satin_alma_talepleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "satin_alma_teklifleri" ADD CONSTRAINT "satin_alma_teklifleri_tedarikci_cari_id_fkey" FOREIGN KEY ("tedarikci_cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "satin_alma_teklif_kalemleri" ADD CONSTRAINT "satin_alma_teklif_kalemleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "satin_alma_teklif_kalemleri" ADD CONSTRAINT "satin_alma_teklif_kalemleri_teklif_id_fkey" FOREIGN KEY ("teklif_id") REFERENCES "satin_alma_teklifleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "satin_alma_teklif_kalemleri" ADD CONSTRAINT "satin_alma_teklif_kalemleri_talep_kalemi_id_fkey" FOREIGN KEY ("talep_kalemi_id") REFERENCES "satin_alma_talep_kalemleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "satin_alma_talep_olaylari" ADD CONSTRAINT "satin_alma_talep_olaylari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "satin_alma_talep_olaylari" ADD CONSTRAINT "satin_alma_talep_olaylari_talep_id_fkey" FOREIGN KEY ("talep_id") REFERENCES "satin_alma_talepleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "satin_alma_talep_olaylari" ADD CONSTRAINT "satin_alma_talep_olaylari_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "satin_alma_sayaclari" ADD CONSTRAINT "satin_alma_sayaclari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Kiracı yalıtımı.
ALTER TABLE "satin_alma_talepleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "satin_alma_talepleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_satin_alma_talepleri" ON "satin_alma_talepleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "satin_alma_talep_kalemleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "satin_alma_talep_kalemleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_satin_alma_talep_kalemleri" ON "satin_alma_talep_kalemleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "satin_alma_teklifleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "satin_alma_teklifleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_satin_alma_teklifleri" ON "satin_alma_teklifleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "satin_alma_teklif_kalemleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "satin_alma_teklif_kalemleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_satin_alma_teklif_kalemleri" ON "satin_alma_teklif_kalemleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "satin_alma_talep_olaylari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "satin_alma_talep_olaylari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_satin_alma_talep_olaylari" ON "satin_alma_talep_olaylari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "satin_alma_sayaclari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "satin_alma_sayaclari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_satin_alma_sayaclari" ON "satin_alma_sayaclari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- SAT-03: olay geçmişi yalnız eklenir (belge durum geçmişiyle aynı kalıp).
REVOKE UPDATE, DELETE ON TABLE "satin_alma_talep_olaylari" FROM tekir_app;
