-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('yonetici', 'muhasebe', 'satis', 'salt_okunur');

-- CreateEnum
CREATE TYPE "BaglantiAile" AS ENUM ('ebelge', 'pazaryeri', 'pos', 'banka');

-- CreateEnum
CREATE TYPE "BaglantiDurumu" AS ENUM ('pasif', 'aktif', 'hata');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "unvan" TEXT NOT NULL,
    "vkn" TEXT NOT NULL,
    "vergi_dairesi" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "eposta" TEXT NOT NULL,
    "parola_hash" TEXT NOT NULL,
    "ad_soyad" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modul_ayarlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "modul" TEXT NOT NULL,
    "ayarlar" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modul_ayarlari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baglantilar" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "aile" "BaglantiAile" NOT NULL,
    "saglayici" TEXT NOT NULL,
    "sifreli_config" TEXT NOT NULL,
    "durum" "BaglantiDurumu" NOT NULL DEFAULT 'pasif',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "baglantilar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "islem" TEXT NOT NULL,
    "varlik" TEXT NOT NULL,
    "varlik_id" TEXT,
    "detay" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_vkn_key" ON "tenants"("vkn");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_eposta_key" ON "users"("tenant_id", "eposta");

-- CreateIndex
CREATE UNIQUE INDEX "modul_ayarlari_tenant_id_modul_key" ON "modul_ayarlari"("tenant_id", "modul");

-- CreateIndex
CREATE INDEX "baglantilar_tenant_id_aile_idx" ON "baglantilar"("tenant_id", "aile");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modul_ayarlari" ADD CONSTRAINT "modul_ayarlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baglantilar" ADD CONSTRAINT "baglantilar_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
