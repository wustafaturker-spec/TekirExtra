-- ETC-02: katalogdaki "Yakında" platformlar için "İlgileniyorum" talebi (firma başına platform başına bir).
CREATE TABLE IF NOT EXISTS "entegrasyon_talepleri" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "saglayici" VARCHAR(40) NOT NULL,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "entegrasyon_talepleri_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "entegrasyon_talepleri_tenant_id_saglayici_key" ON "entegrasyon_talepleri"("tenant_id", "saglayici");
ALTER TABLE "entegrasyon_talepleri" ADD CONSTRAINT "entegrasyon_talepleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entegrasyon_talepleri" ADD CONSTRAINT "entegrasyon_talepleri_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "entegrasyon_talepleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "entegrasyon_talepleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_entegrasyon_talepleri ON "entegrasyon_talepleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
-- SEC-17: kullanıcı aynı kiracıda olmalı.
CREATE TRIGGER kbag_entegrasyon_talepleri_user_id_fkey AFTER INSERT OR UPDATE OF user_id, tenant_id ON "entegrasyon_talepleri"
  FOR EACH ROW WHEN (NEW.user_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('user_id', 'users', 'id');
GRANT SELECT, INSERT, DELETE ON "entegrasyon_talepleri" TO tekir_app;

-- Platform ekranı için yalnız sayılar: hangi firmanın istediği dönmez.
CREATE OR REPLACE FUNCTION platform_entegrasyon_talep_sayilari()
RETURNS TABLE (saglayici text, firma_sayisi integer, son_talep timestamp)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT t.saglayici::text, count(*)::integer, max(t.created_at)
  FROM entegrasyon_talepleri t
  GROUP BY t.saglayici
  ORDER BY count(*) DESC, t.saglayici;
$$;
REVOKE ALL ON FUNCTION platform_entegrasyon_talep_sayilari() FROM PUBLIC, tekir_app;
GRANT EXECUTE ON FUNCTION platform_entegrasyon_talep_sayilari() TO tekir_platform;
