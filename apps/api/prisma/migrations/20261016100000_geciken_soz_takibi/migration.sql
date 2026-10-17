CREATE TABLE tahsilat_soz_baglantilari (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 soz_id UUID NOT NULL REFERENCES odeme_sozleri(id),
 takip_id UUID NOT NULL REFERENCES tahsilat_takipleri(id),
 user_id UUID NOT NULL,
 kalan DECIMAL(15,2) NOT NULL CHECK(kalan > 0),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX tahsilat_soz_baglantilari_soz_id_key ON tahsilat_soz_baglantilari(soz_id);
CREATE INDEX tahsilat_soz_baglantilari_tenant_id_takip_id_created_at_idx ON tahsilat_soz_baglantilari(tenant_id,takip_id,created_at);
ALTER TABLE tahsilat_soz_baglantilari ENABLE ROW LEVEL SECURITY;
ALTER TABLE tahsilat_soz_baglantilari FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tahsilat_soz_baglantilari
 USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT, INSERT ON tahsilat_soz_baglantilari TO tekir_app;
REVOKE UPDATE, DELETE ON tahsilat_soz_baglantilari FROM tekir_app;
CREATE FUNCTION tahsilat_soz_bagi_kapsami() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Soz takip gecmisi degistirilemez' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS (SELECT 1 FROM odeme_sozleri s JOIN tahsilat_takipleri t ON t.id=NEW.takip_id
   WHERE s.id=NEW.soz_id AND s.tenant_id=NEW.tenant_id AND t.tenant_id=NEW.tenant_id
   AND s.cari_id=t.cari_id AND s.kayit_durumu='aktif' AND t.durum IN ('acik','beklemede'))
   OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND tenant_id=NEW.tenant_id AND aktif AND rol IN ('yonetici','muhasebe'))
 THEN RAISE EXCEPTION 'Soz takip bagi kapsami gecersiz' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tahsilat_soz_bagi_kapsami BEFORE INSERT OR UPDATE OR DELETE ON tahsilat_soz_baglantilari FOR EACH ROW EXECUTE FUNCTION tahsilat_soz_bagi_kapsami();
CREATE INDEX odeme_sozleri_geciken_tarama_idx ON odeme_sozleri(tenant_id,soz_tarihi,id) WHERE kayit_durumu='aktif';
