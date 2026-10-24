CREATE UNIQUE INDEX belge_satirlari_tenant_id_id_key ON belge_satirlari(tenant_id,id);
CREATE TABLE siparis_giris_tarihleri (
 tenant_id UUID NOT NULL,
 satir_id UUID NOT NULL,
 tarih DATE,
 surum INTEGER NOT NULL DEFAULT 1 CHECK (surum > 0),
 kaynak_ozeti VARCHAR(64) NOT NULL,
 gerekce VARCHAR(1000) NOT NULL,
 dogrulayan_user_id UUID NOT NULL,
 guncellendi_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (tenant_id,satir_id),
 UNIQUE (satir_id),
 FOREIGN KEY (tenant_id,satir_id) REFERENCES belge_satirlari(tenant_id,id) ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE siparis_giris_tarihleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE siparis_giris_tarihleri FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON siparis_giris_tarihleri
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON siparis_giris_tarihleri TO tekir_app;
REVOKE DELETE ON siparis_giris_tarihleri FROM tekir_app;
