CREATE UNIQUE INDEX faturalar_f03_pay_kapsam ON faturalar(id,tenant_id,cari_id);
CREATE TABLE firsat_kapama_paylari (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id),
 cari_id UUID NOT NULL, firsat_id UUID NOT NULL, fatura_id UUID NOT NULL,
 -- Kapama denkleştirmede silinebilir; geçmiş kimliği bilinçli olarak FK değildir.
 kapama_id UUID NOT NULL, surum INTEGER NOT NULL CHECK(surum BETWEEN 1 AND 200),
 tutar DECIMAL(15,2) NOT NULL CHECK(tutar>=0),
 kaynak_ozeti VARCHAR(64) NOT NULL, kanit_ozeti VARCHAR(64) NOT NULL,
 istek_anahtari UUID NOT NULL, girdi_ozeti VARCHAR(64) NOT NULL,
 gerekce VARCHAR(500) NOT NULL CHECK(length(trim(gerekce))>=2),
 olusturan_user_id UUID NOT NULL REFERENCES users(id), created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(firsat_id,tenant_id,cari_id) REFERENCES crm_firsatlari(id,tenant_id,cari_id) ON DELETE RESTRICT,
 FOREIGN KEY(fatura_id,tenant_id,cari_id) REFERENCES faturalar(id,tenant_id,cari_id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,istek_anahtari), UNIQUE(tenant_id,kapama_id,firsat_id,surum)
);
CREATE INDEX firsat_kapama_paylari_fatura_idx ON firsat_kapama_paylari(tenant_id,fatura_id);
ALTER TABLE firsat_kapama_paylari ENABLE ROW LEVEL SECURITY;
ALTER TABLE firsat_kapama_paylari FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON firsat_kapama_paylari
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT ON firsat_kapama_paylari TO tekir_app;
REVOKE UPDATE,DELETE ON firsat_kapama_paylari FROM tekir_app;
CREATE FUNCTION firsat_kapama_payi_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.olusturan_user_id AND tenant_id=NEW.tenant_id AND aktif AND rol IN ('yonetici','muhasebe')) THEN
 RAISE EXCEPTION 'Aktif yonetici veya muhasebe gerekli' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER firsat_kapama_payi_actor BEFORE INSERT ON firsat_kapama_paylari
 FOR EACH ROW EXECUTE FUNCTION firsat_kapama_payi_actor();
