CREATE UNIQUE INDEX crm_firsatlari_bag_kapsami ON crm_firsatlari(id,tenant_id,cari_id);
CREATE UNIQUE INDEX belgeler_firsat_bag_kapsami ON belgeler(id,tenant_id,cari_id);
CREATE TABLE firsat_belge_baglari (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id),
 cari_id UUID NOT NULL REFERENCES cari_hesaplar(id),
 firsat_id UUID NOT NULL REFERENCES crm_firsatlari(id) ON DELETE RESTRICT,
 belge_id UUID NOT NULL REFERENCES belgeler(id) ON DELETE RESTRICT,
 olusturan_user_id UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 gerekce VARCHAR(500) NOT NULL CHECK(length(trim(gerekce)) >= 2),
 istek_anahtari UUID NOT NULL,
 girdi_ozeti VARCHAR(64) NOT NULL,
 surum INTEGER NOT NULL DEFAULT 1,
 cozuldu_at TIMESTAMP(3), cozen_user_id UUID REFERENCES users(id),
 cozme_gerekcesi VARCHAR(500), cozme_istek_anahtari UUID, cozme_girdi_ozeti VARCHAR(64),
 CHECK ((cozuldu_at IS NULL AND surum=1 AND cozen_user_id IS NULL AND cozme_gerekcesi IS NULL AND cozme_istek_anahtari IS NULL AND cozme_girdi_ozeti IS NULL)
 OR (cozuldu_at IS NOT NULL AND surum=2 AND cozen_user_id IS NOT NULL AND cozme_gerekcesi IS NOT NULL AND length(trim(cozme_gerekcesi)) >= 2 AND cozme_istek_anahtari IS NOT NULL AND cozme_girdi_ozeti IS NOT NULL)),
 FOREIGN KEY(firsat_id,tenant_id,cari_id) REFERENCES crm_firsatlari(id,tenant_id,cari_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY(belge_id,tenant_id,cari_id) REFERENCES belgeler(id,tenant_id,cari_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 UNIQUE(tenant_id,istek_anahtari), UNIQUE(tenant_id,cozme_istek_anahtari)
);
CREATE UNIQUE INDEX firsat_belge_baglari_aktif_belge ON firsat_belge_baglari(tenant_id,belge_id) WHERE cozuldu_at IS NULL;
CREATE INDEX firsat_belge_baglari_firsat_idx ON firsat_belge_baglari(tenant_id,firsat_id,created_at);
ALTER TABLE firsat_belge_baglari ENABLE ROW LEVEL SECURITY;
ALTER TABLE firsat_belge_baglari FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON firsat_belge_baglari
 USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON firsat_belge_baglari TO tekir_app;
REVOKE DELETE ON firsat_belge_baglari FROM tekir_app;

CREATE FUNCTION firsat_belge_kapsami() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f RECORD; b RECORD; actor UUID;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.surum<>1 OR NEW.cozuldu_at IS NOT NULL THEN RAISE EXCEPTION 'Yeni bag aktif olmali' USING ERRCODE='23514'; END IF;
  SELECT tenant_id,cari_id INTO f FROM crm_firsatlari WHERE id=NEW.firsat_id FOR UPDATE;
  SELECT tenant_id,cari_id,tur,yon INTO b FROM belgeler WHERE id=NEW.belge_id FOR UPDATE;
  IF f IS NULL OR b IS NULL OR f.tenant_id<>NEW.tenant_id OR b.tenant_id<>NEW.tenant_id
   OR f.cari_id<>b.cari_id OR f.cari_id<>NEW.cari_id OR b.tur<>'teklif' OR b.yon<>'satis' THEN
   RAISE EXCEPTION 'Firsat teklif kapsami gecersiz' USING ERRCODE='23514';
  END IF;
  actor:=NEW.olusturan_user_id;
 ELSE
  IF (NEW.id,NEW.tenant_id,NEW.firsat_id,NEW.belge_id,NEW.cari_id,NEW.olusturan_user_id,NEW.created_at,NEW.gerekce,NEW.istek_anahtari,NEW.girdi_ozeti)
   IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.firsat_id,OLD.belge_id,OLD.cari_id,OLD.olusturan_user_id,OLD.created_at,OLD.gerekce,OLD.istek_anahtari,OLD.girdi_ozeti)
   OR OLD.cozuldu_at IS NOT NULL OR NEW.cozuldu_at IS NULL OR NEW.surum<>2 THEN
   RAISE EXCEPTION 'Firsat belge gecmisi degistirilemez' USING ERRCODE='23514';
  END IF;
  actor:=NEW.cozen_user_id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND tenant_id=NEW.tenant_id AND aktif AND rol IN ('yonetici','satis')) THEN
  RAISE EXCEPTION 'Firsat belge kullanicisi gecersiz' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER firsat_belge_kapsami BEFORE INSERT OR UPDATE ON firsat_belge_baglari FOR EACH ROW EXECUTE FUNCTION firsat_belge_kapsami();

-- Kaynağın cari/tür kimliği geçmişteki bağı da sessizce başka işe taşımamalı.
CREATE FUNCTION firsat_belge_kaynak_kimligi() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='crm_firsatlari' THEN
  IF (NEW.tenant_id,NEW.cari_id) IS DISTINCT FROM (OLD.tenant_id,OLD.cari_id)
   AND EXISTS(SELECT 1 FROM firsat_belge_baglari WHERE firsat_id=OLD.id) THEN
   RAISE EXCEPTION 'Bag gecmisi olan firsatin carisi degistirilemez' USING ERRCODE='23514';
  END IF;
 ELSE
  IF (NEW.tenant_id,NEW.cari_id,NEW.tur,NEW.yon) IS DISTINCT FROM (OLD.tenant_id,OLD.cari_id,OLD.tur,OLD.yon)
   AND EXISTS(SELECT 1 FROM firsat_belge_baglari WHERE belge_id=OLD.id) THEN
   RAISE EXCEPTION 'Bag gecmisi olan teklifin kimligi degistirilemez' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER firsat_belge_firsat_kimligi BEFORE UPDATE OF tenant_id,cari_id ON crm_firsatlari FOR EACH ROW EXECUTE FUNCTION firsat_belge_kaynak_kimligi();
CREATE TRIGGER firsat_belge_belge_kimligi BEFORE UPDATE OF tenant_id,cari_id,tur,yon ON belgeler FOR EACH ROW EXECUTE FUNCTION firsat_belge_kaynak_kimligi();
