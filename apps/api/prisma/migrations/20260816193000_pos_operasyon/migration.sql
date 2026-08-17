ALTER TYPE "PosTahsilatDurumu" ADD VALUE IF NOT EXISTS 'iptal';
ALTER TYPE "PosTahsilatDurumu" ADD VALUE IF NOT EXISTS 'suresi_doldu';

ALTER TABLE "pos_tahsilatlari"
  ADD COLUMN "odeme_tarihi" TIMESTAMP(3),
  ADD COLUMN "son_kullanim_tarihi" TIMESTAMP(3),
  ADD COLUMN "deneme_sayisi" INTEGER NOT NULL DEFAULT 1;

UPDATE "pos_tahsilatlari"
SET "son_kullanim_tarihi" = "created_at" + INTERVAL '7 days'
WHERE "son_kullanim_tarihi" IS NULL AND "durum" = 'baslatildi';

UPDATE "pos_tahsilatlari"
SET "odeme_tarihi" = "updated_at"
WHERE "odeme_tarihi" IS NULL AND "durum" = 'odendi';
