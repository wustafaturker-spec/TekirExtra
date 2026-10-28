-- PLT-07: platform kullanıcısı davetle açılır (parola + zorunlu 2FA kurulumu);
-- 2FA sıfırlanınca aynı bağlantıyla yeniden kurulur. Bağlantı kullanılana kadar
-- hesap giriş yapamaz. Yalnız anahtarın sha256 özeti saklanır.
ALTER TABLE "platform_kullanicilari"
  ADD COLUMN "davet_turu" TEXT,
  ADD COLUMN "davet_anahtar_ozeti" TEXT,
  ADD COLUMN "davet_son_gecerlilik" TIMESTAMP(3);

ALTER TABLE "platform_kullanicilari"
  ADD CONSTRAINT "platform_kullanicilari_davet_turu_check" CHECK ("davet_turu" IS NULL OR "davet_turu" IN ('hesap', 'iki_adim'));

CREATE UNIQUE INDEX "platform_kullanicilari_davet_anahtar_ozeti_key" ON "platform_kullanicilari"("davet_anahtar_ozeti");
