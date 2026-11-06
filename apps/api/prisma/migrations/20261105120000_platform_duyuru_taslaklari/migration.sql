BEGIN;
CREATE TABLE platform_duyurular (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baslik varchar(200) NOT NULL CHECK (length(btrim(baslik)) >= 3),
  icerik text NOT NULL CHECK (length(btrim(icerik)) BETWEEN 1 AND 20000),
  buton_metni varchar(80), buton_url varchar(2000),
  durum text NOT NULL DEFAULT 'taslak' CHECK (durum IN ('taslak','arsiv')),
  surum integer NOT NULL DEFAULT 1 CHECK (surum > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((buton_metni IS NULL) = (buton_url IS NULL))
);
CREATE INDEX platform_duyurular_liste ON platform_duyurular(updated_at DESC, id DESC);
CREATE TABLE platform_duyuru_gecmisi (
  duyuru_id uuid NOT NULL REFERENCES platform_duyurular(id) ON DELETE RESTRICT,
  surum integer NOT NULL CHECK (surum > 0),
  kullanici_id uuid NOT NULL REFERENCES platform_kullanicilari(id) ON DELETE RESTRICT,
  icerik jsonb NOT NULL, zaman timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (duyuru_id, surum)
);
CREATE FUNCTION platform_duyuru_koru() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.durum <> 'taslak' OR NEW.surum <> OLD.surum + 1
    OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Duyuru arsivi, kimligi ve surum sirasi korunmalidir';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_duyuru_koru BEFORE UPDATE ON platform_duyurular FOR EACH ROW EXECUTE FUNCTION platform_duyuru_koru();
REVOKE ALL ON platform_duyurular, platform_duyuru_gecmisi FROM PUBLIC, tekir_app, tekir_platform;
GRANT SELECT, INSERT, UPDATE ON platform_duyurular TO tekir_platform;
GRANT SELECT, INSERT ON platform_duyuru_gecmisi TO tekir_platform;
ALTER TABLE platform_duyurular ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_duyurular FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_duyuru_gecmisi ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_duyuru_gecmisi FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_erisim ON platform_duyurular TO tekir_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_erisim ON platform_duyuru_gecmisi TO tekir_platform USING (true) WITH CHECK (true);
COMMIT;
