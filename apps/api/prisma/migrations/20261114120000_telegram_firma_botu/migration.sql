-- CNL-19: firmaya özel Telegram botu. Anahtar şifreli ve firma kapsamlıdır (RLS). Telegram süreci
-- bütün firma botlarını dar bir SECURITY DEFINER işleviyle okur. Bağ, bağlama kodu ve mesaj izi
-- hangi bota ait olduğunu taşır: güncelleme numarası bot başına ayrı sayıldığı için tekrar
-- koruması (bot, güncelleme) çiftidir. Platform botu 0 (iz) ya da NULL (bağ/kod) ile gösterilir.

CREATE TABLE "telegram_firma_botlari" (
    "tenant_id" UUID NOT NULL,
    "bot_kimlik" BIGINT NOT NULL,
    "bot_adi" VARCHAR(64) NOT NULL,
    "sifreli_anahtar" TEXT NOT NULL,
    "durum" VARCHAR(12) NOT NULL DEFAULT 'etkin',
    "hata_turu" VARCHAR(40),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_firma_botlari_pkey" PRIMARY KEY ("tenant_id"),
    CONSTRAINT "telegram_firma_botlari_durum_check" CHECK ("durum" IN ('etkin', 'gecersiz')),
    CONSTRAINT "telegram_firma_botlari_bot_kimlik_check" CHECK ("bot_kimlik" > 0)
);
-- Bir bot yalnız bir firmada kullanılabilir.
CREATE UNIQUE INDEX "telegram_firma_botlari_bot_kimlik_key" ON "telegram_firma_botlari"("bot_kimlik");
ALTER TABLE "telegram_firma_botlari" ADD CONSTRAINT "telegram_firma_botlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_firma_botlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_firma_botlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_telegram_firma_botlari ON "telegram_firma_botlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Firma botuna geçişte düşen bağların hesapları: platform botu bu hesaplara yeni botun adını söyler.
CREATE TABLE "telegram_bot_gecisleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "telegram_kullanici_id" BIGINT NOT NULL,
    "bot_adi" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_bot_gecisleri_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "telegram_bot_gecisleri_telegram_kullanici_id_idx" ON "telegram_bot_gecisleri"("telegram_kullanici_id", "created_at");
CREATE INDEX "telegram_bot_gecisleri_tenant_id_idx" ON "telegram_bot_gecisleri"("tenant_id");
ALTER TABLE "telegram_bot_gecisleri" ADD CONSTRAINT "telegram_bot_gecisleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_bot_gecisleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_bot_gecisleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_telegram_bot_gecisleri ON "telegram_bot_gecisleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "telegram_baglari" ADD COLUMN "bot_kimlik" BIGINT;
ALTER TABLE "telegram_baglama_kodlari" ADD COLUMN "bot_kimlik" BIGINT;
ALTER TABLE "telegram_mesajlari" ADD COLUMN "bot_kimlik" BIGINT NOT NULL DEFAULT 0;
DROP INDEX "telegram_mesajlari_guncelleme_no_key";
CREATE UNIQUE INDEX "telegram_mesajlari_bot_kimlik_guncelleme_no_key" ON "telegram_mesajlari"("bot_kimlik", "guncelleme_no");

-- CNL-17b + CNL-19d: firma ve kullanıcının yanında bağın hangi bota ait olduğu da döner.
CREATE OR REPLACE FUNCTION telegram_bag_coz_bot(p_telegram_kullanici_id BIGINT)
RETURNS TABLE (tenant_id UUID, user_id UUID, bot_kimlik BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT b.tenant_id, b.user_id, b.bot_kimlik FROM telegram_baglari b WHERE b.telegram_kullanici_id = p_telegram_kullanici_id
$$;

CREATE OR REPLACE FUNCTION telegram_kod_coz_bot(p_kod_ozeti TEXT)
RETURNS TABLE (tenant_id UUID, user_id UUID, bot_kimlik BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT k.tenant_id, k.user_id, k.bot_kimlik FROM telegram_baglama_kodlari k
  WHERE k.kod_ozeti = p_kod_ozeti AND k.kullanildi_at IS NULL AND k.son_gecerlilik > (now() AT TIME ZONE 'UTC')
$$;

-- Telegram süreci: çalıştırılacak firma botları (anahtar şifreli döner, süreç çözer).
CREATE OR REPLACE FUNCTION telegram_firma_botlari_oku()
RETURNS TABLE (tenant_id UUID, bot_kimlik BIGINT, bot_adi VARCHAR, sifreli_anahtar TEXT, durum VARCHAR, updated_at TIMESTAMP(3))
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT f.tenant_id, f.bot_kimlik, f.bot_adi, f.sifreli_anahtar, f.durum, f.updated_at FROM telegram_firma_botlari f
$$;

-- Panel: bot başka bir firmada kullanılıyor mu? Yalnız evet/hayır döner.
CREATE OR REPLACE FUNCTION telegram_bot_baska_firmada(p_bot_kimlik BIGINT, p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT EXISTS (SELECT 1 FROM telegram_firma_botlari f WHERE f.bot_kimlik = p_bot_kimlik AND f.tenant_id <> p_tenant_id)
$$;

-- Platform botu: bu hesabın firması son 90 günde kendi botuna geçtiyse yeni botun adı.
CREATE OR REPLACE FUNCTION telegram_gecis_coz(p_telegram_kullanici_id BIGINT)
RETURNS TABLE (bot_adi VARCHAR)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT g.bot_adi FROM telegram_bot_gecisleri g
  WHERE g.telegram_kullanici_id = p_telegram_kullanici_id AND g.created_at > (now() AT TIME ZONE 'UTC') - INTERVAL '90 days'
  ORDER BY g.created_at DESC LIMIT 1
$$;

REVOKE ALL ON FUNCTION telegram_bag_coz_bot(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION telegram_kod_coz_bot(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION telegram_firma_botlari_oku() FROM PUBLIC;
REVOKE ALL ON FUNCTION telegram_bot_baska_firmada(BIGINT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION telegram_gecis_coz(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION telegram_bag_coz_bot(BIGINT) TO tekir_app;
GRANT EXECUTE ON FUNCTION telegram_kod_coz_bot(TEXT) TO tekir_app;
GRANT EXECUTE ON FUNCTION telegram_firma_botlari_oku() TO tekir_app;
GRANT EXECUTE ON FUNCTION telegram_bot_baska_firmada(BIGINT, UUID) TO tekir_app;
GRANT EXECUTE ON FUNCTION telegram_gecis_coz(BIGINT) TO tekir_app;
