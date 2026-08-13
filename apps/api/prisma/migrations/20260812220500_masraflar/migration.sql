CREATE TYPE "MasrafBelgeTuru" AS ENUM ('fis', 'fatura', 'kira', 'dekont', 'serbest_meslek_makbuzu', 'diger');
CREATE TYPE "MasrafDurum" AS ENUM ('taslak', 'onaylandi', 'iptal');
CREATE TYPE "MasrafOdemeDurumu" AS ENUM ('odenmedi', 'odendi');

ALTER TYPE "EkSahipTur" ADD VALUE 'masraf';

CREATE TABLE "masraf_kategorileri" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "ad" TEXT NOT NULL,
  "varsayilan_kdv_orani" DECIMAL(5,2),
  "muhasebe_kodu" TEXT,
  "aktif" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "masraf_kategorileri_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "masraflar" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "kategori_id" UUID NOT NULL,
  "cari_id" UUID,
  "belge_turu" "MasrafBelgeTuru" NOT NULL,
  "belge_no" TEXT,
  "tarih" DATE NOT NULL,
  "vade_tarihi" DATE,
  "satici_unvan" TEXT,
  "vkn_tckn" TEXT,
  "vergi_dairesi" TEXT,
  "iban" TEXT,
  "aciklama" TEXT,
  "matrah" DECIMAL(15,2) NOT NULL,
  "kdv_orani" DECIMAL(5,2) NOT NULL DEFAULT 20,
  "kdv_tutari" DECIMAL(15,2) NOT NULL,
  "toplam" DECIMAL(15,2) NOT NULL,
  "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
  "durum" "MasrafDurum" NOT NULL DEFAULT 'taslak',
  "odeme_durumu" "MasrafOdemeDurumu" NOT NULL DEFAULT 'odenmedi',
  "odeme_tarihi" DATE,
  "kasa_id" UUID,
  "banka_hesap_id" UUID,
  "hareket_id" UUID,
  "stopaj_orani" DECIMAL(5,2),
  "stopaj_tutari" DECIMAL(15,2),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "masraflar_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "masraf_kategorileri_tenant_id_ad_key" ON "masraf_kategorileri"("tenant_id", "ad");
CREATE INDEX "masraf_kategorileri_tenant_id_aktif_idx" ON "masraf_kategorileri"("tenant_id", "aktif");
CREATE UNIQUE INDEX "masraflar_hareket_id_key" ON "masraflar"("hareket_id");
CREATE INDEX "masraflar_tenant_id_tarih_idx" ON "masraflar"("tenant_id", "tarih");
CREATE INDEX "masraflar_tenant_id_kategori_id_durum_idx" ON "masraflar"("tenant_id", "kategori_id", "durum");
CREATE INDEX "masraflar_tenant_id_odeme_durumu_vade_tarihi_idx" ON "masraflar"("tenant_id", "odeme_durumu", "vade_tarihi");

ALTER TABLE "masraf_kategorileri" ADD CONSTRAINT "masraf_kategorileri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "masraflar" ADD CONSTRAINT "masraflar_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "masraflar" ADD CONSTRAINT "masraflar_kategori_id_fkey" FOREIGN KEY ("kategori_id") REFERENCES "masraf_kategorileri"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "masraflar" ADD CONSTRAINT "masraflar_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "masraflar" ADD CONSTRAINT "masraflar_kasa_id_fkey" FOREIGN KEY ("kasa_id") REFERENCES "kasalar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "masraflar" ADD CONSTRAINT "masraflar_banka_hesap_id_fkey" FOREIGN KEY ("banka_hesap_id") REFERENCES "banka_hesaplari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "masraflar" ADD CONSTRAINT "masraflar_hareket_id_fkey" FOREIGN KEY ("hareket_id") REFERENCES "kasa_banka_hareketleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "masraf_kategorileri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "masraflar" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "masraf_kategorileri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON "masraflar" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
