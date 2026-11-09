-- ILT: platformun merkezi e-posta ayarı (tek satır) ve gönderim kaydı. İleti gövdesi saklanmaz.
CREATE TABLE "platform_ileti_ayari" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "host" VARCHAR(255) NOT NULL,
    "port" INTEGER NOT NULL,
    "guvenlik" VARCHAR(10) NOT NULL,
    "kullanici_adi" VARCHAR(255),
    "sifreli_parola" TEXT,
    "gonderici_adi" VARCHAR(120) NOT NULL,
    "gonderici_eposta" VARCHAR(255) NOT NULL,
    "yanit_adresi" VARCHAR(255),
    "guncelleyen_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_ileti_ayari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_ileti_ayari_tek_satir" CHECK ("id" = 1),
    CONSTRAINT "platform_ileti_ayari_guvenlik_check" CHECK ("guvenlik" IN ('yok', 'starttls', 'ssl'))
);
CREATE TABLE "platform_ileti_kayitlari" (
    "id" UUID NOT NULL,
    "anahtar" VARCHAR(128),
    "kanal" VARCHAR(10) NOT NULL DEFAULT 'eposta',
    "tur" VARCHAR(40) NOT NULL,
    "tenant_id" UUID,
    "alicilar" TEXT NOT NULL,
    "konu" TEXT NOT NULL,
    "durum" VARCHAR(12) NOT NULL,
    "deneme" INTEGER NOT NULL DEFAULT 0,
    "hata" TEXT,
    "saglayici_no" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gonderildi_at" TIMESTAMP(3),
    CONSTRAINT "platform_ileti_kayitlari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_ileti_kayitlari_durum_check" CHECK ("durum" IN ('kuyrukta', 'gonderildi', 'basarisiz', 'belirsiz'))
);
CREATE UNIQUE INDEX "platform_ileti_kayitlari_anahtar_key" ON "platform_ileti_kayitlari"("anahtar");
CREATE INDEX "platform_ileti_kayitlari_durum_created_at_idx" ON "platform_ileti_kayitlari"("durum", "created_at");
CREATE INDEX "platform_ileti_kayitlari_created_at_idx" ON "platform_ileti_kayitlari"("created_at");

GRANT SELECT, INSERT, UPDATE ON "platform_ileti_ayari" TO tekir_platform;
GRANT SELECT, INSERT, UPDATE ON "platform_ileti_kayitlari" TO tekir_platform;
