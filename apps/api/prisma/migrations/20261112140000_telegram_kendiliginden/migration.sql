-- CNL-06/07/08 (aşama B): kendiliğinden Telegram mesajı. Bildirim merkezinin teslimatı üçüncü
-- kanal olarak Telegram'a da düşer; ritim tercihleri sessiz saatle aynı kullanıcı ayarındadır.
ALTER TABLE "bildirim_kullanici_ayarlari"
  ADD COLUMN "telegram_gunluk_sinir" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "telegram_min_onem" "BildirimOnemi" NOT NULL DEFAULT 'uyari',
  ADD COLUMN "telegram_konular" "BildirimTuru"[] NOT NULL DEFAULT ARRAY['onay', 'yapay_zeka', 'ebelge', 'donem', 'vade']::"BildirimTuru"[],
  ADD COLUMN "telegram_brifing" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "telegram_sus_bitis" TIMESTAMP(3),
  ADD CONSTRAINT "bildirim_kullanici_ayarlari_telegram_gunluk_sinir_check" CHECK ("telegram_gunluk_sinir" BETWEEN 0 AND 20);

-- Teslimat Telegram'da en çok bir kez işlenir: gönderildi, özete girdi ya da gerekçeyle atlandı.
ALTER TABLE "bildirim_teslimatlari"
  ADD COLUMN "telegram_islendi_at" TIMESTAMP(3),
  ADD COLUMN "telegram_sonuc" VARCHAR(16);

-- Telegram süreci yalnız bağı olan firmaları tarar; işlev firma kimliğinden başka bir şey döndürmez.
CREATE OR REPLACE FUNCTION telegram_bagli_firmalar()
RETURNS TABLE (tenant_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT DISTINCT b.tenant_id FROM telegram_baglari b
$$;
REVOKE ALL ON FUNCTION telegram_bagli_firmalar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION telegram_bagli_firmalar() TO tekir_app;
