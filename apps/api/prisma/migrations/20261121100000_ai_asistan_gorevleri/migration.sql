-- AI-105: arka planda süren asistan analizi. Kuyruğun kaynağı bu tablodur; worker işi
-- sahiplik anahtarı ve kira süresiyle atomik olarak alır, süren işte kirayı tazeler.
-- Kirası dolan iş (worker çöktü) bir kez devralınır; sonuç mesajı ile durum aynı işlemde yazılır.

CREATE TABLE IF NOT EXISTS "ai_asistan_gorevleri" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "oturum_id" UUID NOT NULL,
    "istek_id" UUID NOT NULL,
    "istek_mesaj_id" UUID NOT NULL,
    "mesaj" TEXT NOT NULL,
    "baglam" JSONB,
    "durum" VARCHAR(20) NOT NULL DEFAULT 'kuyrukta',
    "deneme" SMALLINT NOT NULL DEFAULT 0,
    "sahiplik_anahtari" UUID,
    "kira_bitis_at" TIMESTAMP(3),
    "sonuc_mesaj_id" UUID,
    "hata" TEXT,
    "basladi_at" TIMESTAMP(3),
    "bitti_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_asistan_gorevleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_asistan_gorevleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_asistan_gorevleri_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_asistan_gorevleri_oturum_id_fkey" FOREIGN KEY ("oturum_id") REFERENCES "ajan_oturumlari"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_asistan_gorevleri_tenant_id_user_id_istek_id_key" UNIQUE ("tenant_id", "user_id", "istek_id"),
    CONSTRAINT "ai_asistan_gorevleri_durum_check" CHECK (durum IN ('kuyrukta', 'calisiyor', 'tamamlandi', 'hata', 'iptal'))
);

CREATE INDEX IF NOT EXISTS "ai_asistan_gorevleri_durum_kira_idx" ON "ai_asistan_gorevleri"("durum", "kira_bitis_at");
CREATE INDEX IF NOT EXISTS "ai_asistan_gorevleri_tenant_user_durum_idx" ON "ai_asistan_gorevleri"("tenant_id", "user_id", "durum", "created_at");

ALTER TABLE "ai_asistan_gorevleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_asistan_gorevleri" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_ai_asistan_gorevleri ON "ai_asistan_gorevleri";
CREATE POLICY tenant_isolation_ai_asistan_gorevleri ON "ai_asistan_gorevleri"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- SEC-17: kullanıcı ve sohbet aynı kiracıda olmalı.
CREATE TRIGGER kbag_ai_asistan_gorevleri_user_id_fkey AFTER INSERT OR UPDATE OF user_id, tenant_id ON "ai_asistan_gorevleri"
  FOR EACH ROW WHEN (NEW.user_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('user_id', 'users', 'id');
CREATE TRIGGER kbag_ai_asistan_gorevleri_oturum_id_fkey AFTER INSERT OR UPDATE OF oturum_id, tenant_id ON "ai_asistan_gorevleri"
  FOR EACH ROW WHEN (NEW.oturum_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('oturum_id', 'ajan_oturumlari', 'id');
GRANT SELECT, INSERT, UPDATE ON "ai_asistan_gorevleri" TO tekir_app;
