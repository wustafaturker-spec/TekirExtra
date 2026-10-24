CREATE UNIQUE INDEX satin_alma_talepleri_tenant_id_id_key ON satin_alma_talepleri(tenant_id,id);
CREATE TABLE ihtiyac_satin_alma_baglari (
 tenant_id UUID NOT NULL, plan_id UUID NOT NULL, talep_id UUID NOT NULL, user_id UUID NOT NULL,
 istek_ozeti VARCHAR(64) NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,plan_id), UNIQUE(tenant_id,talep_id),
 FOREIGN KEY(tenant_id,plan_id) REFERENCES ihtiyac_planlari(tenant_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY(tenant_id,talep_id) REFERENCES satin_alma_talepleri(tenant_id,id) ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER TABLE ihtiyac_satin_alma_baglari ENABLE ROW LEVEL SECURITY;
ALTER TABLE ihtiyac_satin_alma_baglari FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ihtiyac_satin_alma_baglari USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT ON ihtiyac_satin_alma_baglari TO tekir_app;
REVOKE UPDATE,DELETE ON ihtiyac_satin_alma_baglari FROM tekir_app;
