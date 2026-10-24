-- KLN-12: "Şifremi unuttum" tek kullanımlık bağlantıları.
-- Bilinçli RLS istisnası (eposta_dogrulamalar gibi): bağlantı kiracı bağlamı
-- kurulmadan doğrulanır; tablo kiracı API'sine açık değildir, yalnız token
-- özeti (sha256) saklanır.
CREATE TABLE "parola_sifirlamalar" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "gecerlilik_sonu" TIMESTAMP(3) NOT NULL,
    "kullanildi" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parola_sifirlamalar_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parola_sifirlamalar_token_hash_key" ON "parola_sifirlamalar"("token_hash");
CREATE INDEX "parola_sifirlamalar_user_id_created_at_idx" ON "parola_sifirlamalar"("user_id", "created_at");
