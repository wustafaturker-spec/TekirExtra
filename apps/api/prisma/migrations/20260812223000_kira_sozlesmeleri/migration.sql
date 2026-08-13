CREATE TABLE "kira_sozlesmeleri" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "kategori_id" UUID NOT NULL,
  "cari_id" UUID,
  "baslik" TEXT NOT NULL,
  "tasinmaz_adresi" TEXT,
  "kiraya_veren" TEXT,
  "vkn_tckn" TEXT,
  "iban" TEXT,
  "baslangic_tarihi" DATE NOT NULL,
  "bitis_tarihi" DATE,
  "odeme_gunu" INTEGER NOT NULL DEFAULT 1,
  "matrah" DECIMAL(15,2) NOT NULL,
  "kdv_orani" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "stopaj_orani" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
  "aktif" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "kira_sozlesmeleri_pkey" PRIMARY KEY ("id")
);

ALTER TYPE "EkSahipTur" ADD VALUE 'kira_sozlesme';

ALTER TABLE "masraflar" ADD COLUMN "kira_sozlesme_id" UUID;
ALTER TABLE "masraflar" ADD COLUMN "kira_donemi" DATE;

CREATE INDEX "kira_sozlesmeleri_tenant_id_aktif_baslangic_tarihi_idx" ON "kira_sozlesmeleri"("tenant_id", "aktif", "baslangic_tarihi");
CREATE UNIQUE INDEX "masraflar_kira_sozlesme_id_kira_donemi_key" ON "masraflar"("kira_sozlesme_id", "kira_donemi");

ALTER TABLE "kira_sozlesmeleri" ADD CONSTRAINT "kira_sozlesmeleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kira_sozlesmeleri" ADD CONSTRAINT "kira_sozlesmeleri_kategori_id_fkey" FOREIGN KEY ("kategori_id") REFERENCES "masraf_kategorileri"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kira_sozlesmeleri" ADD CONSTRAINT "kira_sozlesmeleri_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "masraflar" ADD CONSTRAINT "masraflar_kira_sozlesme_id_fkey" FOREIGN KEY ("kira_sozlesme_id") REFERENCES "kira_sozlesmeleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "kira_sozlesmeleri" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "kira_sozlesmeleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
