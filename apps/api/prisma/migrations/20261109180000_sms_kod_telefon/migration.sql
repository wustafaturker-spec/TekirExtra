-- ILT-03/11/12: doğrulanmış kullanıcı telefonu, SMS kodları, platform SMS hesabı ve kritik bildirim SMS kanalı.
ALTER TABLE "users" ADD COLUMN "telefon" VARCHAR(16);
ALTER TABLE "users" ADD COLUMN "telefon_dogrulandi_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "sms_ikinci_adim" BOOLEAN NOT NULL DEFAULT false;

-- Bilinçli RLS istisnası (parola_sifirlamalar gibi): kod giriş öncesi, kiracı bağlamı kurulmadan doğrulanır; yalnız özet saklanır.
CREATE TABLE "sms_dogrulama_kodlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amac" VARCHAR(20) NOT NULL,
    "telefon" VARCHAR(16) NOT NULL,
    "kod_ozeti" VARCHAR(64) NOT NULL,
    "deneme" INTEGER NOT NULL DEFAULT 0,
    "son_gecerlilik" TIMESTAMP(3) NOT NULL,
    "kullanildi" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sms_dogrulama_kodlari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sms_dogrulama_kodlari_amac_check" CHECK ("amac" IN ('telefon_dogrula', 'parola_sifirla', 'giris'))
);
CREATE INDEX "sms_dogrulama_kodlari_user_id_amac_created_at_idx" ON "sms_dogrulama_kodlari"("user_id", "amac", "created_at");
CREATE INDEX "sms_dogrulama_kodlari_telefon_created_at_idx" ON "sms_dogrulama_kodlari"("telefon", "created_at");

CREATE TABLE "platform_sms_ayari" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "kullanici_adi" VARCHAR(100) NOT NULL,
    "sifreli_parola" TEXT NOT NULL,
    "gonderici_adi" VARCHAR(20) NOT NULL,
    "guncelleyen_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_sms_ayari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_sms_ayari_tek_satir" CHECK ("id" = 1)
);
REVOKE ALL ON "platform_sms_ayari" FROM tekir_app;
GRANT SELECT, INSERT, UPDATE ON "platform_sms_ayari" TO tekir_platform;

ALTER TABLE "bildirim_tercihleri" ADD COLUMN "sms" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bildirim_teslimatlari" ADD COLUMN "sms_gonderildi_at" TIMESTAMP(3);
