ALTER TABLE "pos_tahsilatlari" ADD COLUMN "makbuz_anahtari" TEXT;
UPDATE "pos_tahsilatlari" SET "makbuz_anahtari" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') WHERE "makbuz_anahtari" IS NULL;
ALTER TABLE "pos_tahsilatlari" ALTER COLUMN "makbuz_anahtari" SET NOT NULL;
CREATE UNIQUE INDEX "pos_tahsilatlari_makbuz_anahtari_key" ON "pos_tahsilatlari"("makbuz_anahtari");
