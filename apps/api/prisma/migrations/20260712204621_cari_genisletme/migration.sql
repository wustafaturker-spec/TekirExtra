-- CreateEnum
CREATE TYPE "KisiTip" AS ENUM ('gercek', 'tuzel');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdresTip" ADD VALUE 'merkez';
ALTER TYPE "AdresTip" ADD VALUE 'sube';
ALTER TYPE "AdresTip" ADD VALUE 'depo';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CariTip" ADD VALUE 'personel';
ALTER TYPE "CariTip" ADD VALUE 'ortak';
ALTER TYPE "CariTip" ADD VALUE 'diger';

-- AlterTable
ALTER TABLE "cari_adresler" ADD COLUMN     "posta_kodu" TEXT;

-- AlterTable
ALTER TABLE "cari_hesaplar" ADD COLUMN     "faks" TEXT,
ADD COLUMN     "kara_liste" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kara_liste_notu" TEXT,
ADD COLUMN     "kisa_ad" TEXT,
ADD COLUMN     "kisi_tipi" "KisiTip" NOT NULL DEFAULT 'tuzel',
ADD COLUMN     "kvkk_onay_tarihi" DATE,
ADD COLUMN     "mersis_no" TEXT,
ADD COLUMN     "sektor" TEXT,
ADD COLUMN     "temsilci_user_id" UUID,
ADD COLUMN     "ticaret_sicil_no" TEXT,
ADD COLUMN     "web_sitesi" TEXT;

-- CreateTable
CREATE TABLE "cari_banka_hesaplari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cari_id" UUID NOT NULL,
    "banka_adi" TEXT NOT NULL,
    "sube_adi" TEXT,
    "hesap_sahibi" TEXT,
    "iban" TEXT NOT NULL,
    "swift" TEXT,
    "para_birimi" "DovizCinsi" NOT NULL DEFAULT 'TRY',

    CONSTRAINT "cari_banka_hesaplari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cari_etiketleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ad" TEXT NOT NULL,
    "renk" TEXT,

    CONSTRAINT "cari_etiketleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cari_etiket_atamalari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cari_id" UUID NOT NULL,
    "etiket_id" UUID NOT NULL,

    CONSTRAINT "cari_etiket_atamalari_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cari_banka_hesaplari_tenant_id_cari_id_idx" ON "cari_banka_hesaplari"("tenant_id", "cari_id");

-- CreateIndex
CREATE UNIQUE INDEX "cari_etiketleri_tenant_id_ad_key" ON "cari_etiketleri"("tenant_id", "ad");

-- CreateIndex
CREATE UNIQUE INDEX "cari_etiket_atamalari_tenant_id_cari_id_etiket_id_key" ON "cari_etiket_atamalari"("tenant_id", "cari_id", "etiket_id");

-- AddForeignKey
ALTER TABLE "cari_hesaplar" ADD CONSTRAINT "cari_hesaplar_temsilci_user_id_fkey" FOREIGN KEY ("temsilci_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cari_banka_hesaplari" ADD CONSTRAINT "cari_banka_hesaplari_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cari_etiket_atamalari" ADD CONSTRAINT "cari_etiket_atamalari_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cari_etiket_atamalari" ADD CONSTRAINT "cari_etiket_atamalari_etiket_id_fkey" FOREIGN KEY ("etiket_id") REFERENCES "cari_etiketleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Kiracı yalıtımı (KLN-06): yeni cari tabloları + 3. aşamada RLS'i atlanmış
-- fatura/e-belge/kasa-banka tabloları. (auth_kimlikler, oturumlar,
-- eposta_dogrulamalar bilinçli olarak RLS'sizdir — MIMARI §7.)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cari_banka_hesaplari','cari_etiketleri','cari_etiket_atamalari',
    'faturalar','fatura_satirlari','fatura_serileri',
    'ebelge_kayitlari','ebelge_arsiv',
    'kasalar','banka_hesaplari','kasa_banka_hareketleri','cek_senetler'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t);
  END LOOP;
END
$$;
