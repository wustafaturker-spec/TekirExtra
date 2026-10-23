-- CARI-56…62: mükerrer cari raporu ve birleştirme.

-- CARI-60: birleştirilen kart pasif kalır ve ana karta bağlanır.
ALTER TABLE cari_hesaplar ADD COLUMN birlestigi_cari_id UUID REFERENCES cari_hesaplar(id);
CREATE INDEX cari_hesaplar_birlestigi_cari_id_idx ON cari_hesaplar (birlestigi_cari_id) WHERE birlestigi_cari_id IS NOT NULL;
ALTER TABLE cari_hesaplar ADD CONSTRAINT cari_hesaplar_birlesme_kendisi CHECK (birlestigi_cari_id IS NULL OR birlestigi_cari_id <> id);

-- CARI-57: "aynı değil" işareti.
CREATE TABLE cari_mukerrer_istisnalari (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cari_a_id UUID NOT NULL REFERENCES cari_hesaplar(id) ON DELETE CASCADE,
  cari_b_id UUID NOT NULL REFERENCES cari_hesaplar(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (cari_a_id < cari_b_id)
);
CREATE UNIQUE INDEX cari_mukerrer_istisnalari_tenant_id_cari_a_id_cari_b_id_key ON cari_mukerrer_istisnalari (tenant_id, cari_a_id, cari_b_id);
ALTER TABLE cari_mukerrer_istisnalari ENABLE ROW LEVEL SECURITY;
ALTER TABLE cari_mukerrer_istisnalari FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cari_mukerrer_istisnalari
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON cari_mukerrer_istisnalari TO tekir_app;

-- CARI-62: birleştirme izi (yalnız eklenir).
CREATE TABLE cari_birlestirmeleri (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ana_cari_id UUID NOT NULL REFERENCES cari_hesaplar(id),
  tasinan_cari_id UUID NOT NULL REFERENCES cari_hesaplar(id),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  tasinanlar JSONB NOT NULL,
  dusenler JSONB NOT NULL,
  doldurulanlar JSONB NOT NULL,
  uyarilar JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX cari_birlestirmeleri_tenant_id_ana_cari_id_idx ON cari_birlestirmeleri (tenant_id, ana_cari_id);
CREATE INDEX cari_birlestirmeleri_tenant_id_tasinan_cari_id_idx ON cari_birlestirmeleri (tenant_id, tasinan_cari_id);
ALTER TABLE cari_birlestirmeleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE cari_birlestirmeleri FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cari_birlestirmeleri
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT ON cari_birlestirmeleri TO tekir_app;

-- CARI-59: cari hareketleri uygulama rolüne yalnız eklenir (UPDATE kapalı). Birleştirmede
-- kartın hareketleri bu dar işlevle ana karta geçer; iki kart da oturumdaki kiracının olmalıdır.
-- Kapalı dönem tetikleyicisi çalışmaya devam eder.
CREATE FUNCTION cari_birlestirme_hareket_tasi(p_ana UUID, p_tasinan UUID) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t UUID := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  n INTEGER;
BEGIN
  IF t IS NULL OR p_ana = p_tasinan
     OR NOT EXISTS (SELECT 1 FROM cari_hesaplar WHERE id = p_ana AND tenant_id = t AND birlestigi_cari_id IS NULL)
     OR NOT EXISTS (SELECT 1 FROM cari_hesaplar WHERE id = p_tasinan AND tenant_id = t AND birlestigi_cari_id IS NULL) THEN
    RAISE EXCEPTION 'Cari birlestirme kapsami gecersiz' USING ERRCODE = '23514';
  END IF;
  UPDATE cari_hareketler SET cari_id = p_ana WHERE cari_id = p_tasinan AND tenant_id = t;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION cari_birlestirme_hareket_tasi(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cari_birlestirme_hareket_tasi(UUID, UUID) TO tekir_app;
