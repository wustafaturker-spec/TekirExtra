-- EBLG-125…128: ürün kartında KDV dışı vergiler + konaklama vergisi senaryosu.
-- CreateEnum
CREATE TYPE "EkVergiHesap" AS ENUM ('oran', 'birim');

-- AlterEnum
ALTER TYPE "FaturaSenaryo" ADD VALUE 'konaklamavergisi';

-- CreateTable
CREATE TABLE "stok_ek_vergileri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stok_id" UUID NOT NULL,
    "kod" TEXT NOT NULL,
    "hesap" "EkVergiHesap" NOT NULL,
    "deger" DECIMAL(15,4) NOT NULL,
    "sira" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stok_ek_vergileri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stok_ek_vergileri_tenant_id_stok_id_idx" ON "stok_ek_vergileri"("tenant_id", "stok_id");

-- CreateIndex
CREATE UNIQUE INDEX "stok_ek_vergileri_stok_id_kod_key" ON "stok_ek_vergileri"("stok_id", "kod");

-- AddForeignKey
ALTER TABLE "stok_ek_vergileri" ADD CONSTRAINT "stok_ek_vergileri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stok_ek_vergileri" ADD CONSTRAINT "stok_ek_vergileri_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "stok_ek_vergileri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stok_ek_vergileri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stok_ek_vergileri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
