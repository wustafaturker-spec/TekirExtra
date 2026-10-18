-- AI-38…43: gönderilen teklifin takibi (yanıt eşleştirme, hatırlatma, geçerlilik uyarısı).

-- Teklif takibi bildirimleri kendi türünde (tercih ekranında ayrı açılıp kapanır).
ALTER TYPE "BildirimTuru" ADD VALUE IF NOT EXISTS 'teklif';

-- Gelen e-postanın yanıtladığı iletiler (In-Reply-To + References) ve eşleştiği teklif.
ALTER TABLE gelen_epostalar ADD COLUMN yanitlanan_mesaj_idleri TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE gelen_epostalar ADD COLUMN teklif_belge_id UUID REFERENCES belgeler(id) ON DELETE SET NULL;

-- Teklif başına tek takip; yeniden gönderim aynı kaydı tazeler, yeni sürüm (revizyon) yeni belgedir.
CREATE TABLE teklif_takipleri (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  belge_id UUID NOT NULL REFERENCES belgeler(id) ON DELETE CASCADE,
  kaynak TEXT NOT NULL CHECK (kaynak IN ('eposta', 'elle')),
  durum TEXT NOT NULL CHECK (durum IN ('yanit_bekliyor', 'hatirlatildi', 'yanit_geldi', 'kapandi')),
  alici TEXT,
  mesaj_idleri TEXT[] NOT NULL DEFAULT '{}',
  sorumlu_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  gonderildi_at TIMESTAMP(3) NOT NULL,
  gonderim_sayisi INTEGER NOT NULL DEFAULT 1,
  hatirlatma_gunu DATE NOT NULL,
  hatirlatildi_at TIMESTAMP(3),
  gecerlilik_uyarisi_at TIMESTAMP(3),
  yanit_eposta_id UUID REFERENCES gelen_epostalar(id) ON DELETE SET NULL,
  yanit_at TIMESTAMP(3),
  crm_gorev_id UUID REFERENCES crm_gorevleri(id) ON DELETE SET NULL,
  kapanis_nedeni TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX teklif_takipleri_belge_id_key ON teklif_takipleri(belge_id);
CREATE INDEX teklif_takipleri_tenant_id_durum_hatirlatma_gunu_idx ON teklif_takipleri(tenant_id, durum, hatirlatma_gunu);
CREATE INDEX teklif_takipleri_mesaj_idleri_idx ON teklif_takipleri USING GIN (mesaj_idleri);
ALTER TABLE teklif_takipleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE teklif_takipleri FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON teklif_takipleri
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON teklif_takipleri TO tekir_app;
