-- CreateEnum
CREATE TYPE "EkstreSatirDurum" AS ENUM ('beklemede', 'eslesti', 'yoksayildi');

-- AlterTable
ALTER TABLE "banka_hesaplari" ADD COLUMN     "ekstre_eslemesi" JSONB;

-- CreateTable
CREATE TABLE "banka_ekstreleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "banka_hesap_id" UUID NOT NULL,
    "dosya_adi" TEXT NOT NULL,
    "satir_sayisi" INTEGER NOT NULL,
    "yeni_satir_sayisi" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banka_ekstreleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banka_ekstre_satirlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ekstre_id" UUID NOT NULL,
    "banka_hesap_id" UUID NOT NULL,
    "tarih" DATE NOT NULL,
    "tutar" DECIMAL(15,2) NOT NULL,
    "aciklama" TEXT NOT NULL,
    "dekont_no" TEXT,
    "karsi_iban" TEXT,
    "karsi_unvan" TEXT,
    "bakiye" DECIMAL(15,2),
    "durum" "EkstreSatirDurum" NOT NULL DEFAULT 'beklemede',
    "cari_id" UUID,
    "fatura_id" UUID,
    "hareket_id" UUID,
    "satir_ozeti" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banka_ekstre_satirlari_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "banka_ekstreleri_tenant_id_banka_hesap_id_idx" ON "banka_ekstreleri"("tenant_id", "banka_hesap_id");

-- CreateIndex
CREATE UNIQUE INDEX "banka_ekstre_satirlari_hareket_id_key" ON "banka_ekstre_satirlari"("hareket_id");

-- CreateIndex
CREATE INDEX "banka_ekstre_satirlari_tenant_id_durum_idx" ON "banka_ekstre_satirlari"("tenant_id", "durum");

-- CreateIndex
CREATE UNIQUE INDEX "banka_ekstre_satirlari_tenant_id_banka_hesap_id_satir_ozeti_key" ON "banka_ekstre_satirlari"("tenant_id", "banka_hesap_id", "satir_ozeti");

-- AddForeignKey
ALTER TABLE "banka_ekstreleri" ADD CONSTRAINT "banka_ekstreleri_banka_hesap_id_fkey" FOREIGN KEY ("banka_hesap_id") REFERENCES "banka_hesaplari"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banka_ekstre_satirlari" ADD CONSTRAINT "banka_ekstre_satirlari_ekstre_id_fkey" FOREIGN KEY ("ekstre_id") REFERENCES "banka_ekstreleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banka_ekstre_satirlari" ADD CONSTRAINT "banka_ekstre_satirlari_banka_hesap_id_fkey" FOREIGN KEY ("banka_hesap_id") REFERENCES "banka_hesaplari"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banka_ekstre_satirlari" ADD CONSTRAINT "banka_ekstre_satirlari_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banka_ekstre_satirlari" ADD CONSTRAINT "banka_ekstre_satirlari_fatura_id_fkey" FOREIGN KEY ("fatura_id") REFERENCES "faturalar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banka_ekstre_satirlari" ADD CONSTRAINT "banka_ekstre_satirlari_hareket_id_fkey" FOREIGN KEY ("hareket_id") REFERENCES "kasa_banka_hareketleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Kiracı yalıtımı (KLN-06): banka ekstresi tabloları
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['banka_ekstreleri','banka_ekstre_satirlari'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t);
  END LOOP;
END
$$;
