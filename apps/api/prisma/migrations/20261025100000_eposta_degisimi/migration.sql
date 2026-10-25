-- KLN-23: e-posta (giriş adı) değişikliği bağlantıları.
-- Bilinçli RLS istisnası (parola_sifirlamalar gibi): bağlantı kiracı bağlamı
-- kurulmadan doğrulanır; tablo kiracı API'sine açık değildir, yalnız token
-- özeti (sha256) saklanır.
CREATE TABLE "eposta_degisimleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "yeni_eposta" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "gecerlilik_sonu" TIMESTAMP(3) NOT NULL,
    "kullanildi" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eposta_degisimleri_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "eposta_degisimleri_token_hash_key" ON "eposta_degisimleri"("token_hash");
CREATE INDEX "eposta_degisimleri_user_id_created_at_idx" ON "eposta_degisimleri"("user_id", "created_at");
