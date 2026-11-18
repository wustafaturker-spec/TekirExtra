-- P-16: Hafıza kapsamı, onaylayan, sürüm ve geçerlilik
ALTER TABLE "ai_hafiza" ADD COLUMN "kapsam" TEXT NOT NULL DEFAULT 'firma';
ALTER TABLE "ai_hafiza" ADD COLUMN "onaylayan_user_id" UUID;
ALTER TABLE "ai_hafiza" ADD COLUMN "surum" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ai_hafiza" ADD COLUMN "son_dogrulama_at" TIMESTAMP(3) WITHOUT TIME ZONE;
ALTER TABLE "ai_hafiza" ADD COLUMN "gecerlilik_bitis_at" TIMESTAMP(3) WITHOUT TIME ZONE;
ALTER TABLE "ai_hafiza" ADD COLUMN "neden_onerildi" TEXT;

ALTER TABLE "ai_hafiza" ADD CONSTRAINT "ai_hafiza_kapsam_check" CHECK (kapsam IN ('firma', 'cari', 'kullanici'));

ALTER TABLE "ai_hafiza" ADD CONSTRAINT "ai_hafiza_onaylayan_user_id_fkey" FOREIGN KEY (onaylayan_user_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE TRIGGER kbag_ai_hafiza_onaylayan_user_id_fkey_auto
  AFTER INSERT OR UPDATE OF onaylayan_user_id, tenant_id ON ai_hafiza
  FOR EACH ROW WHEN (new.onaylayan_user_id IS NOT NULL)
  EXECUTE FUNCTION kiraci_bag_denetle('onaylayan_user_id', 'users', 'id');

-- Mevcut verileri varsayılan kapsama taşı
UPDATE "ai_hafiza" SET "kapsam" = 'cari' WHERE "cari_id" IS NOT NULL;
UPDATE "ai_hafiza" SET "kapsam" = 'kullanici' WHERE "tur" = 'musteri_tercihi' AND "olusturan_user_id" IS NOT NULL;
