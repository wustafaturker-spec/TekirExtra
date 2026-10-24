-- Yönetim P2-4: son giriş zamanı ve "Oturumlarım" listesi.
ALTER TABLE "users" ADD COLUMN "son_giris_at" TIMESTAMP(3);
ALTER TABLE "oturumlar" ADD COLUMN "giris_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "oturumlar" ADD COLUMN "ip" VARCHAR(64);
ALTER TABLE "oturumlar" ADD COLUMN "tarayici" VARCHAR(200);
-- Mevcut oturumlarda giriş anı bilinmiyor; son yenileme anı en yakın değer.
UPDATE "oturumlar" SET "giris_at" = "created_at";
