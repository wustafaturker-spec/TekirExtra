-- Personel tabloları kimlik ve ücret verisi taşır. Ayrı migration kullanılması,
-- personel modülü migration'ı daha önce uygulanmış ortamlarda da korumayı açar.
ALTER TABLE "personel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personel" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_personel" ON "personel"
USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "personel_bordro" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personel_bordro" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_personel_bordro" ON "personel_bordro"
USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "personel_avans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personel_avans" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_personel_avans" ON "personel_avans"
USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
