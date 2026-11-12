-- CNL-01…05, 13, 14, 17, 18, 20 (aşama A): Telegram kanalı.
-- Bütün tablolar firma kapsamlı ve RLS'lidir. Firmalar arası tek okuma iki dar SECURITY DEFINER
-- işlevidir: Telegram hesap kimliğinden (ya da bağlama kodu özetinden) firma/kullanıcı çözümü.
-- Bu işlevler başka hiçbir sütun döndürmez (CNL-17b/c).

ALTER TABLE "ajan_mesaj_gecmisi" ADD COLUMN "kanal" VARCHAR(12) NOT NULL DEFAULT 'WEB';

CREATE TABLE "telegram_baglama_kodlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kod_ozeti" CHAR(64) NOT NULL,
    "son_gecerlilik" TIMESTAMP(3) NOT NULL,
    "kullanildi_at" TIMESTAMP(3),
    "riza_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_baglama_kodlari_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "telegram_baglama_kodlari_kod_ozeti_key" ON "telegram_baglama_kodlari"("kod_ozeti");
CREATE INDEX "telegram_baglama_kodlari_tenant_id_user_id_created_at_idx" ON "telegram_baglama_kodlari"("tenant_id", "user_id", "created_at");
ALTER TABLE "telegram_baglama_kodlari" ADD CONSTRAINT "telegram_baglama_kodlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_baglama_kodlari" ADD CONSTRAINT "telegram_baglama_kodlari_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_baglama_kodlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_baglama_kodlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_telegram_baglama_kodlari ON "telegram_baglama_kodlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE TRIGGER kbag_telegram_baglama_kodlari_user_id_fkey AFTER INSERT OR UPDATE OF user_id, tenant_id ON "telegram_baglama_kodlari"
  FOR EACH ROW WHEN (NEW.user_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('user_id', 'users', 'id');

CREATE TABLE "telegram_baglari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "telegram_kullanici_id" BIGINT NOT NULL,
    "sohbet_id" BIGINT NOT NULL,
    "kullanici_adi" VARCHAR(64),
    "oturum_surumu" INTEGER NOT NULL,
    "riza_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_baglari_pkey" PRIMARY KEY ("id")
);
-- CNL-17a: bir Telegram hesabı bütün platformda tek bağ taşır; bir kullanıcının tek bağı olur.
CREATE UNIQUE INDEX "telegram_baglari_user_id_key" ON "telegram_baglari"("user_id");
CREATE UNIQUE INDEX "telegram_baglari_telegram_kullanici_id_key" ON "telegram_baglari"("telegram_kullanici_id");
CREATE INDEX "telegram_baglari_tenant_id_idx" ON "telegram_baglari"("tenant_id");
ALTER TABLE "telegram_baglari" ADD CONSTRAINT "telegram_baglari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_baglari" ADD CONSTRAINT "telegram_baglari_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_baglari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_baglari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_telegram_baglari ON "telegram_baglari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE TRIGGER kbag_telegram_baglari_user_id_fkey AFTER INSERT OR UPDATE OF user_id, tenant_id ON "telegram_baglari"
  FOR EACH ROW WHEN (NEW.user_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('user_id', 'users', 'id');

CREATE TABLE "telegram_mesajlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "yon" VARCHAR(6) NOT NULL,
    "tur" VARCHAR(20) NOT NULL,
    "durum" VARCHAR(16) NOT NULL,
    "hata_turu" VARCHAR(40),
    "guncelleme_no" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_mesajlari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "telegram_mesajlari_yon_check" CHECK ("yon" IN ('gelen', 'giden'))
);
-- CNL-01: Telegram güncelleme numarası bot genelinde tektir; aynı mesaj ikinci kez işlenmez.
CREATE UNIQUE INDEX "telegram_mesajlari_guncelleme_no_key" ON "telegram_mesajlari"("guncelleme_no");
CREATE INDEX "telegram_mesajlari_tenant_id_created_at_idx" ON "telegram_mesajlari"("tenant_id", "created_at");
ALTER TABLE "telegram_mesajlari" ADD CONSTRAINT "telegram_mesajlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_mesajlari" ADD CONSTRAINT "telegram_mesajlari_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "telegram_mesajlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_mesajlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_telegram_mesajlari ON "telegram_mesajlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE TRIGGER kbag_telegram_mesajlari_user_id_fkey AFTER INSERT OR UPDATE OF user_id, tenant_id ON "telegram_mesajlari"
  FOR EACH ROW WHEN (NEW.user_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('user_id', 'users', 'id');

-- CNL-17b: gelen mesajda firma yalnız bağ kaydından çözülür. Yalnız firma ve kullanıcı döner.
CREATE OR REPLACE FUNCTION telegram_bag_coz(p_telegram_kullanici_id BIGINT)
RETURNS TABLE (tenant_id UUID, user_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT b.tenant_id, b.user_id FROM telegram_baglari b WHERE b.telegram_kullanici_id = p_telegram_kullanici_id
$$;

-- CNL-02/18: kullanılmamış, süresi dolmamış bağlama kodunun sahibi. Kod tüketimi firma bağlamında yapılır.
CREATE OR REPLACE FUNCTION telegram_kod_coz(p_kod_ozeti TEXT)
RETURNS TABLE (tenant_id UUID, user_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT k.tenant_id, k.user_id FROM telegram_baglama_kodlari k
  WHERE k.kod_ozeti = p_kod_ozeti AND k.kullanildi_at IS NULL AND k.son_gecerlilik > (now() AT TIME ZONE 'UTC')
$$;

REVOKE ALL ON FUNCTION telegram_bag_coz(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION telegram_kod_coz(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION telegram_bag_coz(BIGINT) TO tekir_app;
GRANT EXECUTE ON FUNCTION telegram_kod_coz(TEXT) TO tekir_app;
