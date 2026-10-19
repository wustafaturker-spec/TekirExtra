-- AI-58…65: kiracıya ait ajan hafızası (ürün/cari eşleşmesi, müşteri tercihi, sınıflandırma örneği, susturma).

CREATE TABLE ai_hafiza (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tur TEXT NOT NULL CHECK (tur IN ('urun_eslesme', 'cari_eslesme', 'musteri_tercihi', 'siniflandirma', 'susturma')),
  anahtar TEXT NOT NULL CHECK (length(anahtar) BETWEEN 1 AND 320),
  cari_id UUID REFERENCES cari_hesaplar(id) ON DELETE CASCADE,
  stok_id UUID REFERENCES stok_kartlari(id) ON DELETE CASCADE,
  varyant_id UUID REFERENCES stok_varyantlari(id) ON DELETE CASCADE,
  metin TEXT CHECK (metin IS NULL OR length(metin) <= 1000),
  etiket TEXT CHECK (etiket IS NULL OR etiket IN ('teklif', 'teklif_degil')),
  kaynak TEXT NOT NULL CHECK (kaynak IN ('kullanici', 'otomatik', 'ai_onerisi')),
  durum TEXT NOT NULL DEFAULT 'aktif' CHECK (durum IN ('aktif', 'oneri', 'pasif')),
  olusturan_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  kaynak_eposta_id UUID REFERENCES gelen_epostalar(id) ON DELETE SET NULL,
  kullanim_sayisi INTEGER NOT NULL DEFAULT 0,
  son_kullanim_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (tur <> 'urun_eslesme' OR (cari_id IS NOT NULL AND stok_id IS NOT NULL)),
  CHECK (tur NOT IN ('cari_eslesme', 'musteri_tercihi') OR cari_id IS NOT NULL),
  CHECK (tur <> 'siniflandirma' OR etiket IS NOT NULL)
);
-- Tür + cari + anahtar başına tek kayıt (carisiz kayıtlar için sabit boş kimlik).
CREATE UNIQUE INDEX ai_hafiza_tekil ON ai_hafiza (tenant_id, tur, COALESCE(cari_id, '00000000-0000-0000-0000-000000000000'::uuid), anahtar);
CREATE INDEX ai_hafiza_tenant_id_tur_anahtar_idx ON ai_hafiza (tenant_id, tur, anahtar);
CREATE INDEX ai_hafiza_tenant_id_cari_id_idx ON ai_hafiza (tenant_id, cari_id);
ALTER TABLE ai_hafiza ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_hafiza FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_hafiza
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_hafiza TO tekir_app;

-- AI-61: onaylanan teklif bir kez öğrenilir.
ALTER TABLE eposta_teklif_islemleri ADD COLUMN hafiza_islendi_at TIMESTAMP(3);
