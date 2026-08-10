ALTER TABLE "baglantilar" ADD COLUMN "senkron_imleci" TEXT;
ALTER TABLE "baglantilar" ADD COLUMN "son_senkron_tarihi" TIMESTAMP(3);
ALTER TABLE "baglantilar" ADD COLUMN "son_senkron_hatasi" TEXT;
