-- Gelir, proje ve analitik yevmiye altyapısı.

CREATE TYPE "FaturaGelirTuru" AS ENUM (
  'ticari_satis', 'kira_geliri', 'varlik_satisi', 'yansitma', 'hizmet_diger'
);
CREATE TYPE "ProjeDurum" AS ENUM (
  'planlanan', 'aktif', 'tamamlandi', 'durduruldu', 'iptal'
);
CREATE TYPE "ProjeAltKirilimTipi" AS ENUM ('gelir', 'gider', 'her_ikisi');

ALTER TABLE "faturalar"
  ADD COLUMN "gelir_turu" "FaturaGelirTuru" NOT NULL DEFAULT 'ticari_satis';

CREATE TABLE "gelir_kategorileri" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "ad" TEXT NOT NULL,
  "varsayilan_stopaj_orani" DECIMAL(5,2),
  "varsayilan_kdv_orani" DECIMAL(5,2),
  "muhasebe_kodu" TEXT,
  "ust_id" UUID,
  "aktif" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gelir_kategorileri_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "projeler" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "kod" TEXT NOT NULL,
  "ad" TEXT NOT NULL,
  "aciklama" TEXT,
  "cari_id" UUID,
  "baslangic_tarihi" DATE,
  "bitis_tarihi" DATE,
  "durum" "ProjeDurum" NOT NULL DEFAULT 'planlanan',
  "sorumlu_user_id" UUID,
  "hedef_gelir" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "hedef_gider" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "notlar" TEXT,
  "aktif" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "projeler_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "proje_asamalari" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "proje_id" UUID NOT NULL,
  "sira" INTEGER NOT NULL DEFAULT 0,
  "ad" TEXT NOT NULL,
  "aciklama" TEXT,
  "baslangic_tarihi" DATE,
  "bitis_tarihi" DATE,
  "tamamlandi" BOOLEAN NOT NULL DEFAULT false,
  "tamamlanma_tarihi" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proje_asamalari_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "proje_alt_kirilimlari" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "proje_id" UUID NOT NULL,
  "kod" TEXT NOT NULL,
  "ad" TEXT NOT NULL,
  "tip" "ProjeAltKirilimTipi" NOT NULL DEFAULT 'gider',
  "butce_tutari" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "aciklama" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proje_alt_kirilimlari_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "proje_notlari" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "proje_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "icerik" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proje_notlari_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "fatura_satirlari"
  ADD COLUMN "proje_id" UUID,
  ADD COLUMN "proje_alt_kirilim_id" UUID;
ALTER TABLE "masraflar"
  ADD COLUMN "proje_id" UUID,
  ADD COLUMN "proje_alt_kirilim_id" UUID;
ALTER TABLE "kasa_banka_hareketleri"
  ADD COLUMN "proje_id" UUID,
  ADD COLUMN "proje_alt_kirilim_id" UUID;

CREATE TABLE "gelir_kayitlari" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "kategori_id" UUID NOT NULL,
  "tarih" DATE NOT NULL,
  "brut_tutar" DECIMAL(15,2) NOT NULL,
  "stopaj_orani" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "stopaj_tutari" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "kdv_orani" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "kdv_tutari" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "net_tutar" DECIMAL(15,2) NOT NULL,
  "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
  "kur" DECIMAL(15,6) NOT NULL DEFAULT 1,
  "net_tutar_try" DECIMAL(15,2) NOT NULL,
  "aciklama" TEXT,
  "belge_no" TEXT,
  "cari_id" UUID,
  "kasa_id" UUID,
  "banka_hesap_id" UUID,
  "hareket_id" UUID,
  "proje_id" UUID,
  "proje_alt_kirilim_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gelir_kayitlari_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gelir_kategorileri_tenant_id_ad_key"
  ON "gelir_kategorileri"("tenant_id", "ad");
CREATE INDEX "gelir_kategorileri_tenant_id_aktif_idx"
  ON "gelir_kategorileri"("tenant_id", "aktif");
CREATE INDEX "gelir_kategorileri_tenant_id_ust_id_idx"
  ON "gelir_kategorileri"("tenant_id", "ust_id");
CREATE UNIQUE INDEX "projeler_tenant_id_kod_key" ON "projeler"("tenant_id", "kod");
CREATE INDEX "projeler_tenant_id_durum_idx" ON "projeler"("tenant_id", "durum");
CREATE INDEX "projeler_tenant_id_cari_id_idx" ON "projeler"("tenant_id", "cari_id");
CREATE INDEX "proje_asamalari_tenant_id_proje_id_sira_idx"
  ON "proje_asamalari"("tenant_id", "proje_id", "sira");
CREATE UNIQUE INDEX "proje_alt_kirilimlari_tenant_id_proje_id_kod_key"
  ON "proje_alt_kirilimlari"("tenant_id", "proje_id", "kod");
CREATE INDEX "proje_alt_kirilimlari_tenant_id_proje_id_idx"
  ON "proje_alt_kirilimlari"("tenant_id", "proje_id");
CREATE INDEX "proje_notlari_tenant_id_proje_id_created_at_idx"
  ON "proje_notlari"("tenant_id", "proje_id", "created_at");
CREATE UNIQUE INDEX "gelir_kayitlari_hareket_id_key" ON "gelir_kayitlari"("hareket_id");
CREATE INDEX "gelir_kayitlari_tenant_id_tarih_idx" ON "gelir_kayitlari"("tenant_id", "tarih");
CREATE INDEX "gelir_kayitlari_tenant_id_kategori_id_idx"
  ON "gelir_kayitlari"("tenant_id", "kategori_id");
CREATE INDEX "gelir_kayitlari_tenant_id_proje_id_idx"
  ON "gelir_kayitlari"("tenant_id", "proje_id");
CREATE INDEX "fatura_satirlari_tenant_id_proje_id_idx"
  ON "fatura_satirlari"("tenant_id", "proje_id");
CREATE INDEX "masraflar_tenant_id_proje_id_idx" ON "masraflar"("tenant_id", "proje_id");
CREATE INDEX "kasa_banka_hareketleri_tenant_id_proje_id_idx"
  ON "kasa_banka_hareketleri"("tenant_id", "proje_id");

ALTER TABLE "gelir_kategorileri" ADD CONSTRAINT "gelir_kategorileri_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gelir_kategorileri" ADD CONSTRAINT "gelir_kategorileri_ust_id_fkey"
  FOREIGN KEY ("ust_id") REFERENCES "gelir_kategorileri"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projeler" ADD CONSTRAINT "projeler_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projeler" ADD CONSTRAINT "projeler_cari_id_fkey"
  FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projeler" ADD CONSTRAINT "projeler_sorumlu_user_id_fkey"
  FOREIGN KEY ("sorumlu_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "proje_asamalari" ADD CONSTRAINT "proje_asamalari_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proje_asamalari" ADD CONSTRAINT "proje_asamalari_proje_id_fkey"
  FOREIGN KEY ("proje_id") REFERENCES "projeler"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proje_alt_kirilimlari" ADD CONSTRAINT "proje_alt_kirilimlari_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proje_alt_kirilimlari" ADD CONSTRAINT "proje_alt_kirilimlari_proje_id_fkey"
  FOREIGN KEY ("proje_id") REFERENCES "projeler"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proje_notlari" ADD CONSTRAINT "proje_notlari_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proje_notlari" ADD CONSTRAINT "proje_notlari_proje_id_fkey"
  FOREIGN KEY ("proje_id") REFERENCES "projeler"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proje_notlari" ADD CONSTRAINT "proje_notlari_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fatura_satirlari" ADD CONSTRAINT "fatura_satirlari_proje_id_fkey"
  FOREIGN KEY ("proje_id") REFERENCES "projeler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fatura_satirlari" ADD CONSTRAINT "fatura_satirlari_proje_alt_kirilim_id_fkey"
  FOREIGN KEY ("proje_alt_kirilim_id") REFERENCES "proje_alt_kirilimlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "masraflar" ADD CONSTRAINT "masraflar_proje_id_fkey"
  FOREIGN KEY ("proje_id") REFERENCES "projeler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "masraflar" ADD CONSTRAINT "masraflar_proje_alt_kirilim_id_fkey"
  FOREIGN KEY ("proje_alt_kirilim_id") REFERENCES "proje_alt_kirilimlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kasa_banka_hareketleri" ADD CONSTRAINT "kasa_banka_hareketleri_proje_id_fkey"
  FOREIGN KEY ("proje_id") REFERENCES "projeler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kasa_banka_hareketleri" ADD CONSTRAINT "kasa_banka_hareketleri_proje_alt_kirilim_id_fkey"
  FOREIGN KEY ("proje_alt_kirilim_id") REFERENCES "proje_alt_kirilimlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gelir_kayitlari" ADD CONSTRAINT "gelir_kayitlari_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gelir_kayitlari" ADD CONSTRAINT "gelir_kayitlari_kategori_id_fkey"
  FOREIGN KEY ("kategori_id") REFERENCES "gelir_kategorileri"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gelir_kayitlari" ADD CONSTRAINT "gelir_kayitlari_cari_id_fkey"
  FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gelir_kayitlari" ADD CONSTRAINT "gelir_kayitlari_kasa_id_fkey"
  FOREIGN KEY ("kasa_id") REFERENCES "kasalar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gelir_kayitlari" ADD CONSTRAINT "gelir_kayitlari_banka_hesap_id_fkey"
  FOREIGN KEY ("banka_hesap_id") REFERENCES "banka_hesaplari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gelir_kayitlari" ADD CONSTRAINT "gelir_kayitlari_hareket_id_fkey"
  FOREIGN KEY ("hareket_id") REFERENCES "kasa_banka_hareketleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gelir_kayitlari" ADD CONSTRAINT "gelir_kayitlari_proje_id_fkey"
  FOREIGN KEY ("proje_id") REFERENCES "projeler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gelir_kayitlari" ADD CONSTRAINT "gelir_kayitlari_proje_alt_kirilim_id_fkey"
  FOREIGN KEY ("proje_alt_kirilim_id") REFERENCES "proje_alt_kirilimlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Yeni tenant tablolarında veritabanı seviyesinde zorunlu kiracı yalıtımı.
ALTER TABLE "gelir_kategorileri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gelir_kategorileri" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_gelir_kategorileri" ON "gelir_kategorileri"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "gelir_kayitlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gelir_kayitlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_gelir_kayitlari" ON "gelir_kayitlari"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "projeler" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projeler" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_projeler" ON "projeler"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "proje_asamalari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proje_asamalari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_proje_asamalari" ON "proje_asamalari"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "proje_alt_kirilimlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proje_alt_kirilimlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_proje_alt_kirilimlari" ON "proje_alt_kirilimlari"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "proje_notlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proje_notlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_proje_notlari" ON "proje_notlari"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
