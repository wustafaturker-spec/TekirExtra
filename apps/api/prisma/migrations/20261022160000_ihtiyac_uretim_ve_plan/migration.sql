CREATE UNIQUE INDEX depolar_tenant_id_id_key ON depolar(tenant_id,id);
CREATE UNIQUE INDEX uretim_emri_kalemleri_tenant_id_id_key ON uretim_emri_kalemleri(tenant_id,id);
CREATE TABLE ihtiyac_uretim_talepleri (
 tenant_id UUID NOT NULL, kalem_id UUID NOT NULL, depo_id UUID NOT NULL,
 ihtiyac_tarihi DATE NOT NULL, aktif BOOLEAN NOT NULL DEFAULT TRUE,
 surum INTEGER NOT NULL DEFAULT 1 CHECK(surum>0), kaynak_ozeti VARCHAR(64) NOT NULL,
 gerekce VARCHAR(1000) NOT NULL, user_id UUID NOT NULL,
 guncellendi_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,kalem_id), UNIQUE(kalem_id),
 FOREIGN KEY(tenant_id,kalem_id) REFERENCES uretim_emri_kalemleri(tenant_id,id) ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY(tenant_id,depo_id) REFERENCES depolar(tenant_id,id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX ihtiyac_uretim_talepleri_tenant_id_depo_id_idx ON ihtiyac_uretim_talepleri(tenant_id,depo_id);
CREATE TABLE ihtiyac_planlari (
 id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 user_id UUID NOT NULL, istek_anahtari UUID NOT NULL, istek_ozeti VARCHAR(64) NOT NULL,
 sonuc_kaniti VARCHAR(64) NOT NULL, surum INTEGER NOT NULL DEFAULT 1 CHECK(surum=1),
 girdi JSONB NOT NULL, snapshot JSONB NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,istek_anahtari)
);
CREATE INDEX ihtiyac_planlari_tenant_id_created_at_idx ON ihtiyac_planlari(tenant_id,created_at);
CREATE TABLE ihtiyac_karsilama_baglari (
 id UUID PRIMARY KEY, tenant_id UUID NOT NULL, plan_id UUID NOT NULL,
 tur VARCHAR(20) NOT NULL CHECK(tur IN('mevcut_stok','siparis_girisi')),
 kaynak_id VARCHAR(200) NOT NULL, miktar DECIMAL(15,3) NOT NULL CHECK(miktar>0),
 FOREIGN KEY(tenant_id,plan_id) REFERENCES ihtiyac_planlari(tenant_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
 UNIQUE(tenant_id,plan_id,tur,kaynak_id)
);
DO $$ DECLARE tablo TEXT; BEGIN
 FOREACH tablo IN ARRAY ARRAY['ihtiyac_uretim_talepleri','ihtiyac_planlari','ihtiyac_karsilama_baglari'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tablo);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tablo);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',tablo);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON ihtiyac_uretim_talepleri TO tekir_app;
GRANT SELECT,INSERT ON ihtiyac_planlari,ihtiyac_karsilama_baglari TO tekir_app;
REVOKE DELETE ON ihtiyac_uretim_talepleri FROM tekir_app;
REVOKE UPDATE,DELETE ON ihtiyac_planlari,ihtiyac_karsilama_baglari FROM tekir_app;
