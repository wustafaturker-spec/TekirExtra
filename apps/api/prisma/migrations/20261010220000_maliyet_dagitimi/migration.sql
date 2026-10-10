-- STK-40: giderin (masraf / alış hizmet satırı) alış faturalarının stok satırlarına dağıtılması.
-- CreateEnum
CREATE TYPE "MaliyetDagitimYontemi" AS ENUM ('tutar', 'miktar');

-- CreateEnum
CREATE TYPE "MaliyetDagitimDurum" AS ENUM ('aktif', 'iptal');

-- CreateTable
CREATE TABLE "maliyet_dagitimlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kaynak_tur" TEXT NOT NULL,
    "masraf_id" UUID,
    "fatura_satir_id" UUID,
    "tarih" DATE NOT NULL,
    "tutar" DECIMAL(15,2) NOT NULL,
    "yontem" "MaliyetDagitimYontemi" NOT NULL,
    "durum" "MaliyetDagitimDurum" NOT NULL DEFAULT 'aktif',
    "aciklama" TEXT,
    "user_id" UUID,
    "iptal_eden_id" UUID,
    "iptal_tarihi" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maliyet_dagitimlari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maliyet_dagitim_paylari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "dagitim_id" UUID NOT NULL,
    "fatura_id" UUID NOT NULL,
    "fatura_satir_id" UUID NOT NULL,
    "stok_id" UUID NOT NULL,
    "varyant_id" UUID,
    "tutar" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "maliyet_dagitim_paylari_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maliyet_dagitimlari_tenant_id_durum_idx" ON "maliyet_dagitimlari"("tenant_id", "durum");

-- CreateIndex
CREATE INDEX "maliyet_dagitim_paylari_tenant_id_fatura_id_idx" ON "maliyet_dagitim_paylari"("tenant_id", "fatura_id");

-- CreateIndex
CREATE INDEX "maliyet_dagitim_paylari_tenant_id_stok_id_idx" ON "maliyet_dagitim_paylari"("tenant_id", "stok_id");

-- AddForeignKey
ALTER TABLE "maliyet_dagitimlari" ADD CONSTRAINT "maliyet_dagitimlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maliyet_dagitimlari" ADD CONSTRAINT "maliyet_dagitimlari_masraf_id_fkey" FOREIGN KEY ("masraf_id") REFERENCES "masraflar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maliyet_dagitimlari" ADD CONSTRAINT "maliyet_dagitimlari_fatura_satir_id_fkey" FOREIGN KEY ("fatura_satir_id") REFERENCES "fatura_satirlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maliyet_dagitim_paylari" ADD CONSTRAINT "maliyet_dagitim_paylari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maliyet_dagitim_paylari" ADD CONSTRAINT "maliyet_dagitim_paylari_dagitim_id_fkey" FOREIGN KEY ("dagitim_id") REFERENCES "maliyet_dagitimlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maliyet_dagitim_paylari" ADD CONSTRAINT "maliyet_dagitim_paylari_fatura_id_fkey" FOREIGN KEY ("fatura_id") REFERENCES "faturalar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maliyet_dagitim_paylari" ADD CONSTRAINT "maliyet_dagitim_paylari_fatura_satir_id_fkey" FOREIGN KEY ("fatura_satir_id") REFERENCES "fatura_satirlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maliyet_dagitim_paylari" ADD CONSTRAINT "maliyet_dagitim_paylari_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Kaynak başına tek aktif dağıtım.
CREATE UNIQUE INDEX "maliyet_dagitimlari_aktif_masraf_key" ON "maliyet_dagitimlari"("tenant_id", "masraf_id") WHERE "durum" = 'aktif' AND "masraf_id" IS NOT NULL;
CREATE UNIQUE INDEX "maliyet_dagitimlari_aktif_satir_key" ON "maliyet_dagitimlari"("tenant_id", "fatura_satir_id") WHERE "durum" = 'aktif' AND "fatura_satir_id" IS NOT NULL;

ALTER TABLE "maliyet_dagitimlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maliyet_dagitimlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "maliyet_dagitimlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "maliyet_dagitim_paylari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maliyet_dagitim_paylari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "maliyet_dagitim_paylari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
-- Paylar değişmez; geri alma dağıtımın durumunu değiştirir.
REVOKE UPDATE ON TABLE "maliyet_dagitim_paylari" FROM tekir_app;
