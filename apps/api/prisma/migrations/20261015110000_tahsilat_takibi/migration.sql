CREATE TABLE tahsilat_takipleri (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id), cari_id UUID NOT NULL REFERENCES cari_hesaplar(id),
 sorumlu_user_id UUID NOT NULL REFERENCES users(id), olusturan_user_id UUID NOT NULL,
 konu VARCHAR(200) NOT NULL CHECK(length(trim(konu)) >= 2),
 neden TEXT NOT NULL DEFAULT 'tahsilat' CHECK(neden IN ('tahsilat','itiraz')),
 durum TEXT NOT NULL DEFAULT 'acik' CHECK(durum IN ('acik','beklemede','tamamlandi','iptal')),
 sonraki_islem_tarihi DATE, sonraki_islem VARCHAR(200), son_islem_gerekcesi VARCHAR(2000),
 surum INTEGER NOT NULL DEFAULT 1 CHECK(surum > 0),
 istek_anahtari UUID NOT NULL, girdi_ozeti VARCHAR(64) NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ((durum IN ('acik','beklemede') AND sonraki_islem_tarihi IS NOT NULL AND sonraki_islem IS NOT NULL AND length(trim(sonraki_islem)) >= 2)
    OR (durum IN ('tamamlandi','iptal') AND sonraki_islem_tarihi IS NULL AND sonraki_islem IS NULL AND son_islem_gerekcesi IS NOT NULL AND length(trim(son_islem_gerekcesi)) >= 2))
);
CREATE UNIQUE INDEX tahsilat_takipleri_tenant_id_istek_anahtari_key ON tahsilat_takipleri(tenant_id,istek_anahtari);
CREATE UNIQUE INDEX tahsilat_takipleri_aktif_cari_key ON tahsilat_takipleri(tenant_id,cari_id) WHERE durum IN ('acik','beklemede');
CREATE INDEX tahsilat_takipleri_durum_tarih_idx ON tahsilat_takipleri(tenant_id,durum,sonraki_islem_tarihi,id);
CREATE INDEX tahsilat_takipleri_tenant_id_cari_id_idx ON tahsilat_takipleri(tenant_id,cari_id);
CREATE INDEX tahsilat_takipleri_sorumlu_tarih_idx ON tahsilat_takipleri(tenant_id,sorumlu_user_id,sonraki_islem_tarihi);
CREATE TABLE tahsilat_gorusmeleri (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
 takip_id UUID NOT NULL REFERENCES tahsilat_takipleri(id), user_id UUID NOT NULL,
 kanal TEXT NOT NULL CHECK(kanal IN ('telefon','eposta','ziyaret','not')),
 gorusme_tarihi DATE NOT NULL, "not" VARCHAR(2000) NOT NULL CHECK(length(trim("not")) >= 2),
 istek_anahtari UUID NOT NULL, girdi_ozeti VARCHAR(64) NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX tahsilat_gorusmeleri_tenant_id_istek_anahtari_key ON tahsilat_gorusmeleri(tenant_id,istek_anahtari);
CREATE INDEX tahsilat_gorusmeleri_tenant_id_takip_id_created_at_idx ON tahsilat_gorusmeleri(tenant_id,takip_id,created_at);
ALTER TABLE tahsilat_takipleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE tahsilat_takipleri FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tahsilat_takipleri USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE tahsilat_gorusmeleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE tahsilat_gorusmeleri FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tahsilat_gorusmeleri USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
REVOKE DELETE ON tahsilat_takipleri FROM tekir_app;
REVOKE UPDATE, DELETE ON tahsilat_gorusmeleri FROM tekir_app;
CREATE FUNCTION tahsilat_takip_kapsami() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
   IF NEW.durum <> 'acik' OR NEW.surum <> 1 OR NOT EXISTS (SELECT 1 FROM cari_hesaplar WHERE id=NEW.cari_id AND tenant_id=NEW.tenant_id)
    OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.olusturan_user_id AND tenant_id=NEW.tenant_id)
   THEN RAISE EXCEPTION 'Takip baslangic kapsami gecersiz' USING ERRCODE='23514'; END IF;
 ELSE
   IF (NEW.id,NEW.tenant_id,NEW.cari_id,NEW.olusturan_user_id,NEW.konu,NEW.istek_anahtari,NEW.girdi_ozeti,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.cari_id,OLD.olusturan_user_id,OLD.konu,OLD.istek_anahtari,OLD.girdi_ozeti,OLD.created_at)
      OR OLD.durum NOT IN ('acik','beklemede') OR NEW.surum <> OLD.surum+1
   THEN RAISE EXCEPTION 'Takip gecmisi veya surumu degistirilemez' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP = 'INSERT' OR NEW.sorumlu_user_id IS DISTINCT FROM OLD.sorumlu_user_id THEN
   IF NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.sorumlu_user_id AND tenant_id=NEW.tenant_id AND aktif AND rol IN ('yonetici','muhasebe'))
   THEN RAISE EXCEPTION 'Takip sorumlusu gecersiz' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tahsilat_takip_kapsami BEFORE INSERT OR UPDATE ON tahsilat_takipleri FOR EACH ROW EXECUTE FUNCTION tahsilat_takip_kapsami();
CREATE FUNCTION tahsilat_gorusme_kapsami() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM tahsilat_takipleri WHERE id=NEW.takip_id AND tenant_id=NEW.tenant_id AND durum IN ('acik','beklemede'))
   OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND tenant_id=NEW.tenant_id)
 THEN RAISE EXCEPTION 'Gorusme kapsami gecersiz veya takip kapali' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tahsilat_gorusme_kapsami BEFORE INSERT ON tahsilat_gorusmeleri FOR EACH ROW EXECUTE FUNCTION tahsilat_gorusme_kapsami();
