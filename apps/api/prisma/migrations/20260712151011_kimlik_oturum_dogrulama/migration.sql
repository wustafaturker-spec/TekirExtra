-- AlterTable
ALTER TABLE "users" ADD COLUMN     "eposta_dogrulandi" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totp_aktif" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totp_secret_sifreli" TEXT;

-- CreateTable
CREATE TABLE "auth_kimlikler" (
    "id" UUID NOT NULL,
    "eposta" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_kimlikler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oturumlar" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "gecerlilik_sonu" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oturumlar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eposta_dogrulamalar" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "gecerlilik_sonu" TIMESTAMP(3) NOT NULL,
    "kullanildi" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eposta_dogrulamalar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_kimlikler_eposta_key" ON "auth_kimlikler"("eposta");

-- CreateIndex
CREATE UNIQUE INDEX "auth_kimlikler_user_id_key" ON "auth_kimlikler"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oturumlar_refresh_token_hash_key" ON "oturumlar"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "oturumlar_user_id_idx" ON "oturumlar"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "eposta_dogrulamalar_token_hash_key" ON "eposta_dogrulamalar"("token_hash");
