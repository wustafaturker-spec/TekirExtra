-- PRS-21 (P3-4): çalışan self-servisi.
ALTER TYPE "Rol" ADD VALUE IF NOT EXISTS 'calisan';
ALTER TABLE "users" ADD COLUMN "personel_id" UUID, ADD COLUMN "davet_anahtar_ozeti" TEXT, ADD COLUMN "davet_son_gecerlilik" TIMESTAMP(3);
CREATE UNIQUE INDEX "users_personel_id_key" ON "users"("personel_id");
ALTER TABLE "users" ADD CONSTRAINT "users_personel_id_fkey" FOREIGN KEY ("personel_id") REFERENCES "personel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "users_davet_anahtar_ozeti_idx" ON "users"("davet_anahtar_ozeti");
ALTER TABLE "personel" ADD COLUMN "adres" TEXT;
