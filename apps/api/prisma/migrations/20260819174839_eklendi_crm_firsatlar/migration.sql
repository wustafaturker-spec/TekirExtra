-- CreateEnum
CREATE TYPE "CrmFirsatAsamasi" AS ENUM ('yeni_lead', 'iletisim_kuruldu', 'teklif_verildi', 'pazarlik', 'kazanildi', 'kaybedildi');

-- CreateTable
CREATE TABLE "crm_firsatlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "baslik" TEXT NOT NULL,
    "cari_id" UUID NOT NULL,
    "tahmini_tutar" DECIMAL(15,2) NOT NULL,
    "asama" "CrmFirsatAsamasi" NOT NULL DEFAULT 'yeni_lead',
    "kapanis_tarihi" DATE,
    "sorumlu_user_id" UUID,
    "notlar" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_firsatlari_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_firsatlari_tenant_id_cari_id_asama_idx" ON "crm_firsatlari"("tenant_id", "cari_id", "asama");

-- AddForeignKey
ALTER TABLE "crm_firsatlari" ADD CONSTRAINT "crm_firsatlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_firsatlari" ADD CONSTRAINT "crm_firsatlari_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_firsatlari" ADD CONSTRAINT "crm_firsatlari_sorumlu_user_id_fkey" FOREIGN KEY ("sorumlu_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
