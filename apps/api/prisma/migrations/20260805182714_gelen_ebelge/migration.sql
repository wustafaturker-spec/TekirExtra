-- CreateEnum
CREATE TYPE "GelenEbelgeDurum" AS ENUM ('beklemede', 'islendi', 'reddedildi');

-- CreateEnum
CREATE TYPE "GelenEbelgeYanit" AS ENUM ('kabul', 'ret');

-- CreateTable
CREATE TABLE "gelen_ebelgeler" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "uuid" TEXT NOT NULL,
    "belge_no" TEXT NOT NULL,
    "gonderen_vkn" TEXT NOT NULL,
    "gonderen_unvan" TEXT NOT NULL,
    "tarih" DATE NOT NULL,
    "profil_id" TEXT,
    "xml_icerik" TEXT NOT NULL,
    "durum" "GelenEbelgeDurum" NOT NULL DEFAULT 'beklemede',
    "fatura_id" UUID,
    "yanit" "GelenEbelgeYanit",
    "yanit_gerekce" TEXT,
    "yanit_zamani" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gelen_ebelgeler_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gelen_ebelgeler_fatura_id_key" ON "gelen_ebelgeler"("fatura_id");

-- CreateIndex
CREATE INDEX "gelen_ebelgeler_tenant_id_durum_idx" ON "gelen_ebelgeler"("tenant_id", "durum");

-- CreateIndex
CREATE UNIQUE INDEX "gelen_ebelgeler_tenant_id_uuid_key" ON "gelen_ebelgeler"("tenant_id", "uuid");

-- AddForeignKey
ALTER TABLE "gelen_ebelgeler" ADD CONSTRAINT "gelen_ebelgeler_fatura_id_fkey" FOREIGN KEY ("fatura_id") REFERENCES "faturalar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Kiracı yalıtımı (KLN-06): gelen e-belge kutusu
ALTER TABLE "gelen_ebelgeler" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gelen_ebelgeler" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "gelen_ebelgeler"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
