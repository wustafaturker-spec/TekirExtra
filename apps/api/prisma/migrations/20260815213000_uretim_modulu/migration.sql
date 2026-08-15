CREATE TYPE "UretimEmriDurum" AS ENUM ('taslak', 'tamamlandi', 'iptal');

CREATE TABLE "urun_receteleri" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "stok_id" UUID NOT NULL,
  "cikti_miktari" DECIMAL(15,3) NOT NULL DEFAULT 1,
  "aciklama" TEXT,
  "aktif" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "urun_receteleri_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "urun_recetesi_kalemleri" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "recete_id" UUID NOT NULL,
  "malzeme_stok_id" UUID NOT NULL,
  "malzeme_varyant_id" UUID,
  "miktar" DECIMAL(15,3) NOT NULL,
  "fire_orani" DECIMAL(5,2) NOT NULL DEFAULT 0,
  CONSTRAINT "urun_recetesi_kalemleri_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "uretim_emirleri" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "no" TEXT NOT NULL,
  "stok_id" UUID NOT NULL,
  "hedef_depo_id" UUID NOT NULL,
  "planlanan_miktar" DECIMAL(15,3) NOT NULL,
  "uretilen_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,
  "toplam_maliyet" DECIMAL(15,4) NOT NULL DEFAULT 0,
  "tarih" DATE NOT NULL,
  "aciklama" TEXT,
  "durum" "UretimEmriDurum" NOT NULL DEFAULT 'taslak',
  "tamamlanma_tarihi" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "uretim_emirleri_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "uretim_emri_kalemleri" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "uretim_emri_id" UUID NOT NULL,
  "malzeme_stok_id" UUID NOT NULL,
  "malzeme_varyant_id" UUID,
  "planlanan_miktar" DECIMAL(15,3) NOT NULL,
  "sarf_edilen_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,
  "birim_maliyet" DECIMAL(15,4) NOT NULL DEFAULT 0,
  CONSTRAINT "uretim_emri_kalemleri_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "urun_receteleri_tenant_id_stok_id_key" ON "urun_receteleri"("tenant_id", "stok_id");
CREATE UNIQUE INDEX "urun_receteleri_stok_id_key" ON "urun_receteleri"("stok_id");
CREATE INDEX "urun_receteleri_tenant_id_idx" ON "urun_receteleri"("tenant_id");
CREATE UNIQUE INDEX "urun_recetesi_kalemleri_recete_id_malzeme_stok_id_malz_key" ON "urun_recetesi_kalemleri"("recete_id", "malzeme_stok_id", "malzeme_varyant_id");
CREATE INDEX "urun_recetesi_kalemleri_tenant_id_malzeme_stok_id_idx" ON "urun_recetesi_kalemleri"("tenant_id", "malzeme_stok_id");
CREATE UNIQUE INDEX "uretim_emirleri_tenant_id_no_key" ON "uretim_emirleri"("tenant_id", "no");
CREATE INDEX "uretim_emirleri_tenant_id_tarih_idx" ON "uretim_emirleri"("tenant_id", "tarih");
CREATE INDEX "uretim_emri_kalemleri_tenant_id_uretim_emri_id_idx" ON "uretim_emri_kalemleri"("tenant_id", "uretim_emri_id");

ALTER TABLE "urun_receteleri" ADD CONSTRAINT "urun_receteleri_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "urun_recetesi_kalemleri" ADD CONSTRAINT "urun_recetesi_kalemleri_recete_id_fkey" FOREIGN KEY ("recete_id") REFERENCES "urun_receteleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "urun_recetesi_kalemleri" ADD CONSTRAINT "urun_recetesi_kalemleri_malzeme_stok_id_fkey" FOREIGN KEY ("malzeme_stok_id") REFERENCES "stok_kartlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "urun_recetesi_kalemleri" ADD CONSTRAINT "urun_recetesi_kalemleri_malzeme_varyant_id_fkey" FOREIGN KEY ("malzeme_varyant_id") REFERENCES "stok_varyantlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "uretim_emirleri" ADD CONSTRAINT "uretim_emirleri_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "uretim_emirleri" ADD CONSTRAINT "uretim_emirleri_hedef_depo_id_fkey" FOREIGN KEY ("hedef_depo_id") REFERENCES "depolar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "uretim_emri_kalemleri" ADD CONSTRAINT "uretim_emri_kalemleri_uretim_emri_id_fkey" FOREIGN KEY ("uretim_emri_id") REFERENCES "uretim_emirleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "uretim_emri_kalemleri" ADD CONSTRAINT "uretim_emri_kalemleri_malzeme_stok_id_fkey" FOREIGN KEY ("malzeme_stok_id") REFERENCES "stok_kartlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "uretim_emri_kalemleri" ADD CONSTRAINT "uretim_emri_kalemleri_malzeme_varyant_id_fkey" FOREIGN KEY ("malzeme_varyant_id") REFERENCES "stok_varyantlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
