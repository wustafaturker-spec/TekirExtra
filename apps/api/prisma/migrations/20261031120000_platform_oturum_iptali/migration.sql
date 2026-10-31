-- PLT-25: platform oturum sürümü ve sunucu tarafında iptal edilebilen oturumlar.
-- Yalnız ekleme yapar; sürüm/oturum taşımayan eski token'lar uygulamada reddedilir (yeniden giriş).
ALTER TABLE "platform_kullanicilari" ADD COLUMN "oturum_surumu" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "platform_oturumlari" (
  "id" UUID NOT NULL,
  "kullanici_id" UUID NOT NULL,
  "bitis" TIMESTAMP(3) NOT NULL,
  "iptal_at" TIMESTAMP(3),
  "iptal_nedeni" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_oturumlari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_oturumlari_kullanici_id_fkey" FOREIGN KEY ("kullanici_id") REFERENCES "platform_kullanicilari"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "platform_oturumlari_kullanici_id_bitis_idx" ON "platform_oturumlari"("kullanici_id", "bitis");
REVOKE ALL ON "platform_oturumlari" FROM PUBLIC, tekir_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_oturumlari" TO tekir_platform;
