CREATE TABLE platform_firma_takipleri (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  sorumlu_id UUID REFERENCES platform_kullanicilari(id) ON DELETE SET NULL ON UPDATE CASCADE,
  durum VARCHAR(20) NOT NULL DEFAULT 'acik' CHECK (durum IN ('acik', 'bekliyor', 'tamamlandi')),
  sonraki_gorusme DATE,
  surum INTEGER NOT NULL DEFAULT 1 CHECK (surum > 0),
  guncelleyen_id UUID NOT NULL REFERENCES platform_kullanicilari(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX platform_firma_takipleri_sorumlu_durum_idx ON platform_firma_takipleri(sorumlu_id, durum);
CREATE INDEX platform_firma_takipleri_gorusme_idx ON platform_firma_takipleri(sonraki_gorusme) WHERE durum <> 'tamamlandi';

CREATE TABLE platform_firma_notlari (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  yazar_id UUID NOT NULL REFERENCES platform_kullanicilari(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  metin VARCHAR(4000) NOT NULL CHECK (length(btrim(metin)) > 0),
  islem_anahtari UUID NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, yazar_id, islem_anahtari)
);
CREATE INDEX platform_firma_notlari_tenant_zaman_idx ON platform_firma_notlari(tenant_id, created_at, id);

ALTER TABLE platform_gorevleri ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE platform_gorevleri ADD CONSTRAINT platform_gorevleri_firma_kapsami CHECK (tenant_id IS NULL OR kapsam = 'platform');
CREATE INDEX platform_gorevleri_tenant_durum_idx ON platform_gorevleri(tenant_id, durum);

REVOKE ALL ON platform_firma_takipleri, platform_firma_notlari FROM PUBLIC, tekir_app;
GRANT SELECT, INSERT, UPDATE ON platform_firma_takipleri TO tekir_platform;
GRANT SELECT, INSERT ON platform_firma_notlari TO tekir_platform;

ALTER TABLE platform_firma_takipleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_firma_takipleri FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_erisim ON platform_firma_takipleri TO tekir_platform USING (true) WITH CHECK (true);
ALTER TABLE platform_firma_notlari ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_firma_notlari FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_erisim ON platform_firma_notlari TO tekir_platform USING (true) WITH CHECK (true);
ALTER TABLE platform_gorevleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_gorevleri FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_erisim ON platform_gorevleri TO tekir_platform USING (true) WITH CHECK (true);
