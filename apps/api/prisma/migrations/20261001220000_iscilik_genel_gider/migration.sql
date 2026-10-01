-- İş merkezi saatlik maliyetinin işçilik/makine/genel gider kırılımı ve reçete ek giderleri.
-- CreateEnum
CREATE TYPE "ReceteGiderYontemi" AS ENUM ('malzeme_yuzdesi', 'birim_basi', 'emir_basi');

-- AlterTable
ALTER TABLE "is_merkezleri" ADD COLUMN     "genel_gider_saatlik" DECIMAL(15,4) NOT NULL DEFAULT 0,
ADD COLUMN     "iscilik_saatlik" DECIMAL(15,4) NOT NULL DEFAULT 0,
ADD COLUMN     "makine_saatlik" DECIMAL(15,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "uretim_emri_operasyonlari" ADD COLUMN     "genel_gider_saatlik" DECIMAL(15,4) NOT NULL DEFAULT 0,
ADD COLUMN     "iscilik_saatlik" DECIMAL(15,4) NOT NULL DEFAULT 0,
ADD COLUMN     "makine_saatlik" DECIMAL(15,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "uretim_bildirimleri" ADD COLUMN     "ek_gider_maliyeti" DECIMAL(15,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "recete_giderleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "recete_id" UUID NOT NULL,
    "sira" INTEGER NOT NULL,
    "ad" TEXT NOT NULL,
    "yontem" "ReceteGiderYontemi" NOT NULL,
    "deger" DECIMAL(15,4) NOT NULL,

    CONSTRAINT "recete_giderleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uretim_emri_giderleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "uretim_emri_id" UUID NOT NULL,
    "sira" INTEGER NOT NULL,
    "ad" TEXT NOT NULL,
    "yontem" "ReceteGiderYontemi" NOT NULL,
    "deger" DECIMAL(15,4) NOT NULL,
    "planlanan_tutar" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "gerceklesen_tutar" DECIMAL(15,4) NOT NULL DEFAULT 0,

    CONSTRAINT "uretim_emri_giderleri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recete_giderleri_tenant_id_idx" ON "recete_giderleri"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "recete_giderleri_recete_id_sira_key" ON "recete_giderleri"("recete_id", "sira");

-- CreateIndex
CREATE INDEX "uretim_emri_giderleri_tenant_id_idx" ON "uretim_emri_giderleri"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "uretim_emri_giderleri_uretim_emri_id_sira_key" ON "uretim_emri_giderleri"("uretim_emri_id", "sira");

-- AddForeignKey
ALTER TABLE "recete_giderleri" ADD CONSTRAINT "recete_giderleri_recete_id_fkey" FOREIGN KEY ("recete_id") REFERENCES "urun_receteleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uretim_emri_giderleri" ADD CONSTRAINT "uretim_emri_giderleri_uretim_emri_id_fkey" FOREIGN KEY ("uretim_emri_id") REFERENCES "uretim_emirleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Mevcut saatlik maliyet kırılımsızdı; işçilik sayılır (toplam değişmez).
UPDATE "is_merkezleri" SET "iscilik_saatlik" = "saatlik_maliyet";
UPDATE "uretim_emri_operasyonlari" SET "iscilik_saatlik" = "saatlik_maliyet";

ALTER TABLE "recete_giderleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recete_giderleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recete_giderleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "uretim_emri_giderleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uretim_emri_giderleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "uretim_emri_giderleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
