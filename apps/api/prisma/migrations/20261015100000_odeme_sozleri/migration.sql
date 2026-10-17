CREATE TABLE odeme_sozleri (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  cari_id UUID NOT NULL REFERENCES cari_hesaplar(id),
  fatura_id UUID NOT NULL REFERENCES faturalar(id),
  doviz_cinsi "DovizCinsi" NOT NULL,
  tutar DECIMAL(15,2) NOT NULL CHECK (tutar > 0),
  soz_tarihi DATE NOT NULL,
  verildigi_zaman TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  olusturan_user_id UUID NOT NULL,
  aciklama VARCHAR(2000) NOT NULL,
  kayit_durumu TEXT NOT NULL DEFAULT 'aktif' CHECK (kayit_durumu IN ('aktif','iptal','revize')),
  sonlandirma_nedeni VARCHAR(2000),
  surum INTEGER NOT NULL DEFAULT 1 CHECK (surum > 0),
  onceki_soz_id UUID REFERENCES odeme_sozleri(id),
  istek_anahtari UUID NOT NULL,
  girdi_ozeti VARCHAR(64) NOT NULL,
  CHECK ((kayit_durumu = 'aktif' AND sonlandirma_nedeni IS NULL) OR
         (kayit_durumu <> 'aktif' AND length(trim(sonlandirma_nedeni)) >= 2))
);
CREATE UNIQUE INDEX odeme_sozleri_onceki_soz_id_key ON odeme_sozleri(onceki_soz_id);
CREATE UNIQUE INDEX odeme_sozleri_tenant_id_istek_anahtari_key ON odeme_sozleri(tenant_id, istek_anahtari);
CREATE UNIQUE INDEX odeme_sozleri_aktif_fatura_key ON odeme_sozleri(tenant_id, fatura_id) WHERE kayit_durumu = 'aktif';
CREATE INDEX odeme_sozleri_tenant_id_cari_id_verildigi_zaman_idx ON odeme_sozleri(tenant_id,cari_id,verildigi_zaman);
CREATE INDEX odeme_sozleri_tenant_id_fatura_id_idx ON odeme_sozleri(tenant_id,fatura_id);
ALTER TABLE odeme_sozleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE odeme_sozleri FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON odeme_sozleri
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON odeme_sozleri TO tekir_app;
REVOKE DELETE ON odeme_sozleri FROM tekir_app;

-- Hedef ve revizyon bağında RLS'nin tek başına denetlemediği FK kapsamını koru.
CREATE FUNCTION odeme_sozu_kapsamini_dogrula() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (NOT EXISTS (SELECT 1 FROM faturalar f WHERE f.id = NEW.fatura_id
      AND f.tenant_id = NEW.tenant_id AND f.cari_id = NEW.cari_id AND f.doviz_cinsi = NEW.doviz_cinsi AND f.tip = 'satis')
    OR NOT EXISTS (SELECT 1 FROM cari_hesaplar c WHERE c.id = NEW.cari_id AND c.tenant_id = NEW.tenant_id)
    OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.olusturan_user_id AND u.tenant_id = NEW.tenant_id))
  THEN RAISE EXCEPTION 'Odeme sozu hedef kapsami gecersiz' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'INSERT' AND NEW.onceki_soz_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM odeme_sozleri s WHERE s.id = NEW.onceki_soz_id AND s.tenant_id = NEW.tenant_id
      AND s.cari_id = NEW.cari_id AND s.fatura_id = NEW.fatura_id AND s.doviz_cinsi = NEW.doviz_cinsi AND s.kayit_durumu = 'revize'
  ) THEN RAISE EXCEPTION 'Odeme sozu revizyon kapsami gecersiz' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' AND (
    (NEW.id,NEW.tenant_id,NEW.cari_id,NEW.fatura_id,NEW.doviz_cinsi,NEW.tutar,NEW.soz_tarihi,NEW.verildigi_zaman,
     NEW.olusturan_user_id,NEW.aciklama,NEW.onceki_soz_id,NEW.istek_anahtari,NEW.girdi_ozeti)
    IS DISTINCT FROM
    (OLD.id,OLD.tenant_id,OLD.cari_id,OLD.fatura_id,OLD.doviz_cinsi,OLD.tutar,OLD.soz_tarihi,OLD.verildigi_zaman,
     OLD.olusturan_user_id,OLD.aciklama,OLD.onceki_soz_id,OLD.istek_anahtari,OLD.girdi_ozeti)
    OR OLD.kayit_durumu <> 'aktif' OR NEW.kayit_durumu NOT IN ('iptal','revize') OR NEW.surum <> OLD.surum + 1
  ) THEN RAISE EXCEPTION 'Odeme sozu gecmisi degistirilemez' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER odeme_sozu_kapsami BEFORE INSERT OR UPDATE ON odeme_sozleri
  FOR EACH ROW EXECUTE FUNCTION odeme_sozu_kapsamini_dogrula();
