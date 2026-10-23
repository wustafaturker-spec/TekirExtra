-- ARC-01…11 (§3.21): araç takibi. EBLG-25 araç kartı genişletilir.

ALTER TABLE araclar
  ADD COLUMN marka TEXT,
  ADD COLUMN model TEXT,
  ADD COLUMN model_yili INTEGER,
  ADD COLUMN sase_no TEXT,
  ADD COLUMN tur TEXT CHECK (tur IN ('binek', 'hafif_ticari', 'agir_vasita', 'motosiklet', 'is_makinesi', 'diger')),
  ADD COLUMN yakit_turu TEXT,
  ADD COLUMN mulkiyet TEXT CHECK (mulkiyet IN ('oz', 'kiralik', 'diger')),
  ADD COLUMN demirbas_id UUID REFERENCES demirbaslar(id),
  ADD COLUMN kira_sozlesme_id UUID REFERENCES kira_sozlesmeleri(id),
  ADD COLUMN sorumlu_personel_id UUID REFERENCES personel(id),
  ADD COLUMN binek_sinir_yok BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN bakim_km_araligi INTEGER CHECK (bakim_km_araligi > 0),
  ADD COLUMN bakim_ay_araligi INTEGER CHECK (bakim_ay_araligi > 0),
  ADD COLUMN son_bakim_tarihi DATE,
  ADD COLUMN son_bakim_km INTEGER;
CREATE UNIQUE INDEX araclar_demirbas_id_key ON araclar (demirbas_id) WHERE demirbas_id IS NOT NULL;

CREATE TABLE arac_yukumlulukleri (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  arac_id UUID NOT NULL REFERENCES araclar(id) ON DELETE CASCADE,
  tur TEXT NOT NULL CHECK (tur IN ('muayene', 'trafik_sigortasi', 'kasko', 'mtv', 'egzoz', 'takograf', 'diger')),
  baslangic DATE,
  bitis DATE NOT NULL,
  belge_no TEXT,
  tutar DECIMAL(15,2),
  aciklama TEXT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (baslangic IS NULL OR bitis >= baslangic)
);
CREATE INDEX arac_yukumlulukleri_tenant_id_arac_id_tur_idx ON arac_yukumlulukleri (tenant_id, arac_id, tur);

CREATE TABLE arac_giderleri (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  arac_id UUID NOT NULL REFERENCES araclar(id) ON DELETE CASCADE,
  masraf_id UUID REFERENCES masraflar(id) ON DELETE CASCADE,
  fatura_satir_id UUID REFERENCES fatura_satirlari(id) ON DELETE CASCADE,
  kategori TEXT NOT NULL CHECK (kategori IN ('akaryakit', 'bakim', 'lastik', 'hgs', 'otopark', 'sigorta', 'mtv', 'ceza', 'kira', 'diger')),
  tarih DATE NOT NULL,
  tutar_try DECIMAL(15,2) NOT NULL,
  litre DECIMAL(10,2) CHECK (litre > 0),
  km INTEGER CHECK (km >= 0),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (num_nonnulls(masraf_id, fatura_satir_id) = 1)
);
CREATE UNIQUE INDEX arac_giderleri_masraf_id_key ON arac_giderleri (masraf_id) WHERE masraf_id IS NOT NULL;
CREATE UNIQUE INDEX arac_giderleri_fatura_satir_id_key ON arac_giderleri (fatura_satir_id) WHERE fatura_satir_id IS NOT NULL;
CREATE INDEX arac_giderleri_tenant_id_arac_id_tarih_idx ON arac_giderleri (tenant_id, arac_id, tarih);

CREATE TABLE arac_km_kayitlari (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  arac_id UUID NOT NULL REFERENCES araclar(id) ON DELETE CASCADE,
  tarih DATE NOT NULL,
  km INTEGER NOT NULL CHECK (km >= 0),
  kaynak TEXT NOT NULL CHECK (kaynak IN ('elle', 'gider', 'bakim')),
  kaynak_id UUID,
  gerekce TEXT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX arac_km_kayitlari_tenant_id_arac_id_tarih_idx ON arac_km_kayitlari (tenant_id, arac_id, tarih);

CREATE TABLE arac_bakimlari (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  arac_id UUID NOT NULL REFERENCES araclar(id) ON DELETE CASCADE,
  tarih DATE NOT NULL,
  km INTEGER CHECK (km >= 0),
  aciklama TEXT NOT NULL,
  arac_gider_id UUID REFERENCES arac_giderleri(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX arac_bakimlari_tenant_id_arac_id_tarih_idx ON arac_bakimlari (tenant_id, arac_id, tarih);

CREATE TABLE arac_cezalari (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  arac_id UUID NOT NULL REFERENCES araclar(id) ON DELETE CASCADE,
  tarih DATE NOT NULL,
  tutar DECIMAL(15,2) NOT NULL CHECK (tutar > 0),
  ihlal TEXT NOT NULL,
  yer TEXT,
  personel_id UUID REFERENCES personel(id),
  tahsil_notu TEXT,
  arac_gider_id UUID REFERENCES arac_giderleri(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX arac_cezalari_tenant_id_arac_id_tarih_idx ON arac_cezalari (tenant_id, arac_id, tarih);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['arac_yukumlulukleri', 'arac_giderleri', 'arac_km_kayitlari', 'arac_bakimlari', 'arac_cezalari'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO tekir_app', t);
  END LOOP;
END $$;

-- ARC-06: binek gider kısıtı (GVK 40/5).
-- • binek_gider_orani — binek otomobil giderlerinin gider yazılabilecek oranı %70 (7194 s. K., 01.01.2020'den).
-- • binek_kira_siniri — kiralanan binek otomobilin aylık kira bedelinin gider yazılabilecek kısmı (KDV hariç):
--   2025 37.000 TL, 2026 46.000 TL (332 Seri No GVGT, RG 31.12.2025). Yıllık; kayıt yalnız başladığı yılda geçerli.
INSERT INTO "mevzuat_kayitlari" ("id", "tur", "anahtar", "deger", "yururluk_baslangic", "yururluk_bitis") VALUES
  (gen_random_uuid(), 'kanuni_deger', 'binek_gider_orani', '{"deger": 70}'::jsonb, DATE '2020-01-01', NULL),
  (gen_random_uuid(), 'kanuni_deger', 'binek_kira_siniri', '{"deger": 37000}'::jsonb, DATE '2025-01-01', DATE '2025-12-31'),
  (gen_random_uuid(), 'kanuni_deger', 'binek_kira_siniri', '{"deger": 46000}'::jsonb, DATE '2026-01-01', NULL);

INSERT INTO "mevzuat_olaylari" ("id", "olay", "detay") VALUES
  (gen_random_uuid(), 'ilk_dolum', '{"tur": "kanuni_deger", "anahtar": "binek_gider_orani", "kaynak": "GVK 40/5 (7194 s. K.): binek otomobil giderlerinin %70i", "kayit": 1, "yururlukBaslangic": "2020-01-01"}'::jsonb),
  (gen_random_uuid(), 'ilk_dolum', '{"tur": "kanuni_deger", "anahtar": "binek_kira_siniri", "kaynak": "GVK 40/5: aylık kira sınırı 2025 37.000, 2026 46.000 (332 Seri No GVGT)", "kayit": 2, "yururlukBaslangic": "2025-01-01"}'::jsonb);
