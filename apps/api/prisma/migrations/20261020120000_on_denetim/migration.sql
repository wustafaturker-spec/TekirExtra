-- EBLG-141: ön denetim uyarıları geçilerek yapılan gönderimlerin kaydı ve cari başına kural susturma.

CREATE TABLE on_denetim_kararlari (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fatura_id UUID NOT NULL REFERENCES faturalar(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Geçilen uyarılar: [{kod, satir, mesaj}]
  bulgular JSONB NOT NULL,
  gerekce TEXT CHECK (gerekce IS NULL OR length(gerekce) <= 300),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX on_denetim_kararlari_tenant_id_fatura_id_idx ON on_denetim_kararlari (tenant_id, fatura_id);
CREATE INDEX on_denetim_kararlari_tenant_id_created_at_idx ON on_denetim_kararlari (tenant_id, created_at);
ALTER TABLE on_denetim_kararlari ENABLE ROW LEVEL SECURITY;
ALTER TABLE on_denetim_kararlari FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON on_denetim_kararlari
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON on_denetim_kararlari TO tekir_app;

CREATE TABLE on_denetim_susturmalari (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cari_id UUID NOT NULL REFERENCES cari_hesaplar(id) ON DELETE CASCADE,
  kod TEXT NOT NULL CHECK (length(kod) BETWEEN 1 AND 50),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX on_denetim_susturmalari_tenant_id_cari_id_kod_key ON on_denetim_susturmalari (tenant_id, cari_id, kod);
ALTER TABLE on_denetim_susturmalari ENABLE ROW LEVEL SECURITY;
ALTER TABLE on_denetim_susturmalari FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON on_denetim_susturmalari
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON on_denetim_susturmalari TO tekir_app;
