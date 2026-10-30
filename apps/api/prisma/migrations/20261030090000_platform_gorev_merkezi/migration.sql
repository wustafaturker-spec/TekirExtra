CREATE TYPE "PlatformGorevKapsami" AS ENUM ('mevzuat', 'platform');
CREATE TYPE "PlatformGorevDurumu" AS ENUM ('acik', 'devam_ediyor', 'tamamlandi', 'iptal');
CREATE TYPE "PlatformGorevOnceligi" AS ENUM ('dusuk', 'normal', 'yuksek');

CREATE TABLE "platform_gorevleri" (
  "id" UUID NOT NULL,
  "baslik" VARCHAR(200) NOT NULL,
  "aciklama" VARCHAR(4000),
  "kapsam" "PlatformGorevKapsami" NOT NULL DEFAULT 'mevzuat',
  "durum" "PlatformGorevDurumu" NOT NULL DEFAULT 'acik',
  "oncelik" "PlatformGorevOnceligi" NOT NULL DEFAULT 'normal',
  "son_tarih" DATE,
  "sorumlu_id" UUID,
  "olusturan_id" UUID NOT NULL,
  "degisiklik_id" UUID,
  "surum" INTEGER NOT NULL DEFAULT 1 CHECK ("surum" > 0),
  "kapanis_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_gorevleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_gorevleri_sorumlu_id_fkey" FOREIGN KEY ("sorumlu_id") REFERENCES "platform_kullanicilari"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "platform_gorevleri_olusturan_id_fkey" FOREIGN KEY ("olusturan_id") REFERENCES "platform_kullanicilari"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "platform_gorevleri_degisiklik_id_fkey" FOREIGN KEY ("degisiklik_id") REFERENCES "mevzuat_degisiklikleri"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "platform_gorevleri_mevzuat_bagi" CHECK ("kapsam" = 'mevzuat' OR "degisiklik_id" IS NULL)
);
CREATE INDEX "platform_gorevleri_kapsam_durum_son_tarih_idx" ON "platform_gorevleri"("kapsam", "durum", "son_tarih");
CREATE INDEX "platform_gorevleri_sorumlu_id_durum_idx" ON "platform_gorevleri"("sorumlu_id", "durum");
REVOKE ALL ON "platform_gorevleri" FROM PUBLIC, tekir_app;
GRANT SELECT, INSERT, UPDATE ON "platform_gorevleri" TO tekir_platform;
