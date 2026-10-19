-- AI-66…70: teklif iş kutusundan kaldırılan kayıtlar (neden, not, önceki durum; geri alınabilir).

CREATE TABLE is_kutusu_kapanislari (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tur TEXT NOT NULL CHECK (tur IN ('eposta', 'yanit', 'onay')),
  -- eposta: eposta_teklif_islemleri, yanit: teklif_takipleri, onay: ai_onay_talepleri
  kayit_id UUID NOT NULL,
  neden TEXT NOT NULL CHECK (neden IN ('elle_yapildi', 'iptal', 'teklif_degil')),
  not_metni TEXT CHECK (not_metni IS NULL OR length(not_metni) <= 300),
  bagli_belge_id UUID REFERENCES belgeler(id) ON DELETE SET NULL,
  -- silindi | iptal_edildi: e-postadan açılmış taslağa ne yapıldı
  taslak_sonucu TEXT CHECK (taslak_sonucu IS NULL OR taslak_sonucu IN ('silindi', 'iptal_edildi')),
  onceki JSONB NOT NULL DEFAULT '{}',
  sahip_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  kapatan_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  kapandi_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  geri_alan_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  geri_alindi_at TIMESTAMP(3),
  CHECK (tur = 'eposta' OR neden <> 'teklif_degil')
);
-- Kayıt başına tek açık kapanış.
CREATE UNIQUE INDEX is_kutusu_kapanislari_acik ON is_kutusu_kapanislari (tenant_id, tur, kayit_id) WHERE geri_alindi_at IS NULL;
CREATE INDEX is_kutusu_kapanislari_tenant_id_kapandi_at_idx ON is_kutusu_kapanislari (tenant_id, kapandi_at);
ALTER TABLE is_kutusu_kapanislari ENABLE ROW LEVEL SECURITY;
ALTER TABLE is_kutusu_kapanislari FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON is_kutusu_kapanislari
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON is_kutusu_kapanislari TO tekir_app;

-- AI-68: kaldırılan e-posta işlemi kendi durumuyla ayrılır (yeniden denenmez).
ALTER TABLE eposta_teklif_islemleri DROP CONSTRAINT eposta_teklif_islemleri_durum_check;
ALTER TABLE eposta_teklif_islemleri ADD CONSTRAINT eposta_teklif_islemleri_durum_check
  CHECK (durum IN ('isleniyor', 'atlandi', 'teklif_degil', 'incelenmeli', 'cari_secimi', 'cari_onayi_bekliyor', 'cari_yok', 'taslak_hazir', 'sinirda', 'hata', 'kapatildi'));
