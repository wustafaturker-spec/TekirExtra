BEGIN;
CREATE TABLE platform_duyuru_gorselleri (
  id uuid PRIMARY KEY,
  duyuru_id uuid NOT NULL REFERENCES platform_duyurular(id) ON DELETE RESTRICT,
  dosya_adi varchar(240) NOT NULL,
  mime_tip varchar(40) NOT NULL CHECK (mime_tip IN ('image/jpeg','image/png','image/webp')),
  boyut integer NOT NULL CHECK (boyut BETWEEN 1 AND 5242880),
  depo_anahtari varchar(500) NOT NULL UNIQUE,
  yukleyen_kullanici_id uuid NOT NULL REFERENCES platform_kullanicilari(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_duyuru_gorselleri_duyuru ON platform_duyuru_gorselleri(duyuru_id);
REVOKE ALL ON platform_duyuru_gorselleri FROM PUBLIC,tekir_app,tekir_platform;
GRANT SELECT,INSERT ON platform_duyuru_gorselleri TO tekir_platform;
ALTER TABLE platform_duyuru_gorselleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_duyuru_gorselleri FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_erisim ON platform_duyuru_gorselleri TO tekir_platform USING (true) WITH CHECK (true);
COMMIT;
