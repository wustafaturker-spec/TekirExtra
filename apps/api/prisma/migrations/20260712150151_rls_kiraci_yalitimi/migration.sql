-- Kiracı yalıtımı: Row-Level Security (MIMARI §3, KLN-06)
--
-- Uygulama, veritabanına tekir_app rolüyle bağlanır: BYPASSRLS yok, tablo
-- sahibi değil. Her transaction başında `SET LOCAL app.tenant_id` kurulur;
-- politika, satırları bu değere göre süzer. current_setting'in ikinci
-- argümanı true: bağlam kurulmamışsa NULL döner → hiçbir satır eşleşmez.

-- tekir_app rolü normalde docker/postgres-init.sql ile oluşur; başka
-- ortamlarda (ör. CI) eksikse geliştirme parolasıyla oluşturulur.
DO $$
BEGIN
  CREATE ROLE tekir_app LOGIN PASSWORD 'tekir_app_dev';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

GRANT USAGE ON SCHEMA public TO tekir_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tekir_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO tekir_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tekir_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO tekir_app;

-- Prisma'nın migrasyon tablosuna uygulama rolü erişmez
-- (shadow veritabanında tablo bulunmadığından koşullu)
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE _prisma_migrations FROM tekir_app';
  END IF;
END
$$;

-- tenants: kiracı yalnızca kendi firma kaydını görür (tenant_id sütunu yok, id kullanılır)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);

-- Kiracıya ait tablolar: tenant_id politikası
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE modul_ayarlari ENABLE ROW LEVEL SECURITY;
ALTER TABLE modul_ayarlari FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modul_ayarlari
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE baglantilar ENABLE ROW LEVEL SECURITY;
ALTER TABLE baglantilar FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON baglantilar
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- audit_log: salt-ekleme — uygulama rolüne UPDATE/DELETE hiç verilmez (KLN-04)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
REVOKE UPDATE, DELETE ON TABLE audit_log FROM tekir_app;
