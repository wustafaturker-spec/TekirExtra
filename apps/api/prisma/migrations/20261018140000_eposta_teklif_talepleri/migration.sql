-- AI-32…37: gelen e-postadaki teklif talebinden taslak teklif.

-- Otomatik yanıt, bülten ve teslim raporu iletileri senkronda başlıklardan işaretlenir.
ALTER TABLE gelen_epostalar ADD COLUMN otomatik BOOLEAN NOT NULL DEFAULT false;

-- Onay talebi e-posta otomasyonundan da açılabilir (cari açma).
ALTER TYPE "AiIslemKaynagi" ADD VALUE IF NOT EXISTS 'otomasyon';

-- Her gelen e-posta için tek işlem kaydı; worker ile elle çalıştırma aynı kaydı paylaşır.
CREATE TABLE eposta_teklif_islemleri (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  gelen_eposta_id UUID NOT NULL REFERENCES gelen_epostalar(id) ON DELETE CASCADE,
  calistiran_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  durum TEXT NOT NULL CHECK (durum IN ('isleniyor', 'atlandi', 'teklif_degil', 'incelenmeli', 'cari_onayi_bekliyor', 'cari_yok', 'taslak_hazir', 'sinirda', 'hata')),
  guven DECIMAL(4, 3),
  cikarim JSONB,
  kalemler JSONB NOT NULL DEFAULT '[]',
  uyarilar JSONB NOT NULL DEFAULT '[]',
  cari_id UUID REFERENCES cari_hesaplar(id) ON DELETE SET NULL,
  belge_id UUID REFERENCES belgeler(id) ON DELETE SET NULL,
  firsat_id UUID REFERENCES crm_firsatlari(id) ON DELETE SET NULL,
  onay_talebi_id UUID REFERENCES ai_onay_talepleri(id) ON DELETE SET NULL,
  hata TEXT,
  deneme INTEGER NOT NULL DEFAULT 1,
  sonraki_deneme_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX eposta_teklif_islemleri_gelen_eposta_id_key ON eposta_teklif_islemleri(gelen_eposta_id);
CREATE INDEX eposta_teklif_islemleri_tenant_id_durum_idx ON eposta_teklif_islemleri(tenant_id, durum);
ALTER TABLE eposta_teklif_islemleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE eposta_teklif_islemleri FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON eposta_teklif_islemleri
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON eposta_teklif_islemleri TO tekir_app;
