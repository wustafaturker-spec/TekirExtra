-- CARI-49: satış faturası kesinleşirken (ya da geriye dönük) kaydedilen tahmini gecikme.
-- Gerçekleşen gecikme saklanmaz; okumada cari hareketlerinden FIFO ile hesaplanır.
CREATE TABLE fatura_gecikme_tahminleri (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  fatura_id UUID NOT NULL REFERENCES faturalar(id) ON DELETE CASCADE,
  cari_id UUID NOT NULL REFERENCES cari_hesaplar(id),
  tahmin_gun INTEGER,
  guven TEXT CHECK (guven IN ('dusuk', 'orta', 'yuksek')),
  kapanan_borc_sayisi INTEGER NOT NULL DEFAULT 0,
  kaynak TEXT NOT NULL CHECK (kaynak IN ('kesinlesme', 'geriye_donuk')),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX fatura_gecikme_tahminleri_fatura_id_key ON fatura_gecikme_tahminleri(fatura_id);
CREATE INDEX fatura_gecikme_tahminleri_tenant_id_cari_id_idx ON fatura_gecikme_tahminleri(tenant_id, cari_id);
ALTER TABLE fatura_gecikme_tahminleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE fatura_gecikme_tahminleri FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fatura_gecikme_tahminleri
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- Tahmin bir kez yazılır; güncellenmez, silinmez (fatura silinirse CASCADE).
GRANT SELECT, INSERT ON fatura_gecikme_tahminleri TO tekir_app;
