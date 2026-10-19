CREATE TABLE firsat_iade_paylari (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
 cari_id UUID NOT NULL, firsat_id UUID NOT NULL, fatura_id UUID NOT NULL, iade_fatura_id UUID NOT NULL,
 surum INTEGER NOT NULL CHECK(surum BETWEEN 1 AND 200), matrah DECIMAL(15,2) NOT NULL CHECK(matrah>=0),
 kanit_ozeti VARCHAR(64) NOT NULL, istek_anahtari UUID NOT NULL, girdi_ozeti VARCHAR(64) NOT NULL,
 gerekce VARCHAR(500) NOT NULL CHECK(length(trim(gerekce))>=2),
 olusturan_user_id UUID NOT NULL REFERENCES users(id), created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(firsat_id,tenant_id,cari_id) REFERENCES crm_firsatlari(id,tenant_id,cari_id) ON DELETE RESTRICT,
 FOREIGN KEY(fatura_id,tenant_id,cari_id) REFERENCES faturalar(id,tenant_id,cari_id) ON DELETE RESTRICT,
 FOREIGN KEY(iade_fatura_id,tenant_id,cari_id) REFERENCES faturalar(id,tenant_id,cari_id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,istek_anahtari), UNIQUE(tenant_id,fatura_id,iade_fatura_id,firsat_id,surum)
);
CREATE INDEX firsat_iade_paylari_fatura_idx ON firsat_iade_paylari(tenant_id,fatura_id);
ALTER TABLE firsat_iade_paylari ENABLE ROW LEVEL SECURITY;
ALTER TABLE firsat_iade_paylari FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON firsat_iade_paylari
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT ON firsat_iade_paylari TO tekir_app;
REVOKE UPDATE,DELETE ON firsat_iade_paylari FROM tekir_app;
CREATE TRIGGER firsat_iade_payi_actor BEFORE INSERT ON firsat_iade_paylari
 FOR EACH ROW EXECUTE FUNCTION firsat_kapama_payi_actor();
