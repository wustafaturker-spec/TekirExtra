-- DMR-01…14 (§3.20): demirbaş ve sabit kıymet.

ALTER TYPE "EkSahipTur" ADD VALUE IF NOT EXISTS 'demirbas';

CREATE TABLE demirbaslar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kod TEXT NOT NULL,
  ad TEXT NOT NULL,
  sinif TEXT NOT NULL CHECK (sinif IN ('bina', 'tesis_makine', 'tasit', 'demirbas', 'hak', 'ozel_maliyet')),
  hesap_kodu TEXT,
  gider_hesap_kodu TEXT,
  liste_kodu TEXT,
  faydali_omur INTEGER NOT NULL CHECK (faydali_omur BETWEEN 1 AND 100),
  yontem TEXT NOT NULL DEFAULT 'normal' CHECK (yontem IN ('normal', 'azalan')),
  normale_gecis_yili INTEGER,
  binek_oto BOOLEAN NOT NULL DEFAULT false,
  binek_vergili BOOLEAN NOT NULL DEFAULT false,
  binek_sinir_yok BOOLEAN NOT NULL DEFAULT false,
  edinme_tarihi DATE NOT NULL,
  edinme_bedeli DECIMAL(15,2) NOT NULL CHECK (edinme_bedeli > 0),
  doviz_cinsi "DovizCinsi" NOT NULL DEFAULT 'TRY',
  doviz_tutari DECIMAL(15,2),
  kur DECIMAL(15,6),
  tedarikci_cari_id UUID REFERENCES cari_hesaplar(id),
  fatura_satir_id UUID REFERENCES fatura_satirlari(id),
  seri_no TEXT,
  konum TEXT,
  aciklama TEXT,
  durum TEXT NOT NULL DEFAULT 'kullanimda' CHECK (durum IN ('kullanimda', 'elden_cikti')),
  acilis BOOLEAN NOT NULL DEFAULT false,
  acilis_birikmis DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (acilis_birikmis >= 0),
  acilis_son_yil INTEGER,
  cikis_turu TEXT CHECK (cikis_turu IN ('satis', 'hurda', 'kayip', 'bagis')),
  cikis_tarihi DATE,
  cikis_bedeli DECIMAL(15,2),
  cikis_fatura_satir_id UUID REFERENCES fatura_satirlari(id),
  cikis_gerekcesi TEXT,
  cikis_birikmis DECIMAL(15,2),
  cikis_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (acilis_birikmis <= edinme_bedeli),
  CHECK ((durum = 'elden_cikti') = (cikis_turu IS NOT NULL AND cikis_tarihi IS NOT NULL)),
  CHECK (NOT acilis OR acilis_birikmis = 0 OR acilis_son_yil IS NOT NULL)
);
CREATE UNIQUE INDEX demirbaslar_tenant_id_kod_key ON demirbaslar (tenant_id, kod);
CREATE INDEX demirbaslar_tenant_id_durum_idx ON demirbaslar (tenant_id, durum);
CREATE INDEX demirbaslar_tenant_id_fatura_satir_id_idx ON demirbaslar (tenant_id, fatura_satir_id);

CREATE TABLE demirbas_ilave_bedelleri (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  demirbas_id UUID NOT NULL REFERENCES demirbaslar(id) ON DELETE CASCADE,
  tarih DATE NOT NULL,
  tutar DECIMAL(15,2) NOT NULL CHECK (tutar > 0),
  fatura_satir_id UUID REFERENCES fatura_satirlari(id),
  aciklama TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX demirbas_ilave_bedelleri_tenant_id_demirbas_id_idx ON demirbas_ilave_bedelleri (tenant_id, demirbas_id);
CREATE INDEX demirbas_ilave_bedelleri_tenant_id_fatura_satir_id_idx ON demirbas_ilave_bedelleri (tenant_id, fatura_satir_id);

CREATE TABLE amortisman_donemleri (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  yil INTEGER NOT NULL,
  durum TEXT NOT NULL DEFAULT 'kesin' CHECK (durum IN ('kesin', 'geri_alindi')),
  toplam DECIMAL(15,2) NOT NULL,
  toplam_kkeg DECIMAL(15,2) NOT NULL DEFAULT 0,
  kesinlestiren_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  kesinlesme_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  geri_alan_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  geri_alma_at TIMESTAMP(3),
  geri_alma_gerekcesi TEXT
);
CREATE INDEX amortisman_donemleri_tenant_id_yil_idx ON amortisman_donemleri (tenant_id, yil);
-- Bir yılın yalnız bir kesin çalıştırması olur.
CREATE UNIQUE INDEX amortisman_donemleri_kesin_yil ON amortisman_donemleri (tenant_id, yil) WHERE durum = 'kesin';

CREATE TABLE amortisman_satirlari (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  donem_id UUID NOT NULL REFERENCES amortisman_donemleri(id) ON DELETE CASCADE,
  demirbas_id UUID NOT NULL REFERENCES demirbaslar(id) ON DELETE CASCADE,
  yil INTEGER NOT NULL,
  tutar DECIMAL(15,2) NOT NULL CHECK (tutar >= 0),
  kkeg DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (kkeg >= 0 AND kkeg <= tutar),
  birikmis_once DECIMAL(15,2) NOT NULL
);
CREATE UNIQUE INDEX amortisman_satirlari_donem_id_demirbas_id_key ON amortisman_satirlari (donem_id, demirbas_id);
CREATE INDEX amortisman_satirlari_tenant_id_demirbas_id_yil_idx ON amortisman_satirlari (tenant_id, demirbas_id, yil);

CREATE TABLE demirbas_zimmetleri (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  demirbas_id UUID NOT NULL REFERENCES demirbaslar(id) ON DELETE CASCADE,
  personel_id UUID REFERENCES personel(id),
  konum TEXT,
  baslangic DATE NOT NULL,
  bitis DATE,
  aciklama TEXT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (personel_id IS NOT NULL OR konum IS NOT NULL),
  CHECK (bitis IS NULL OR bitis >= baslangic)
);
CREATE INDEX demirbas_zimmetleri_tenant_id_demirbas_id_idx ON demirbas_zimmetleri (tenant_id, demirbas_id);
CREATE INDEX demirbas_zimmetleri_tenant_id_personel_id_idx ON demirbas_zimmetleri (tenant_id, personel_id);
-- Bir kartın aynı anda tek açık zimmeti olur.
CREATE UNIQUE INDEX demirbas_zimmetleri_acik ON demirbas_zimmetleri (demirbas_id) WHERE bitis IS NULL;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['demirbaslar', 'demirbas_ilave_bedelleri', 'amortisman_donemleri', 'amortisman_satirlari', 'demirbas_zimmetleri'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO tekir_app', t);
  END LOOP;
END $$;

-- DMR-03/06: Mevzuat Merkezi kanuni değerleri (yıllık; kayıt yalnız başladığı yılda geçerli).
-- • dogrudan_gider_siniri — VUK 313 doğrudan gider yazılacak demirbaş: 2026 12.000 TL
--   (588 Sıra No VUK GT, RG 31.12.2025/33124 5. Mük.). 2025 ve öncesi yüklenmedi.
-- • binek_amortisman_siniri — GVK 40/5, ÖTV ve KDV hariç ilk iktisap bedeli:
--   2025 1.100.000 TL, 2026 1.380.000 TL.
-- • binek_amortisman_siniri_vergili — vergiler maliyete eklendiğinde ya da ikinci el:
--   2025 2.100.000 TL, 2026 2.600.000 TL.
--   (Binek tutarları ikincil kaynaklardan: ekonomigazetesi.com "Binek otomobillerin 2026
--   giderleri ve amortismanları", muhasebenews.com; resmî tebliğ metniyle teyit edilmeli.)
INSERT INTO "mevzuat_kayitlari" ("id", "tur", "anahtar", "deger", "yururluk_baslangic", "yururluk_bitis") VALUES
  (gen_random_uuid(), 'kanuni_deger', 'dogrudan_gider_siniri', '{"deger": 12000}'::jsonb, DATE '2026-01-01', NULL),
  (gen_random_uuid(), 'kanuni_deger', 'binek_amortisman_siniri', '{"deger": 1100000}'::jsonb, DATE '2025-01-01', DATE '2025-12-31'),
  (gen_random_uuid(), 'kanuni_deger', 'binek_amortisman_siniri', '{"deger": 1380000}'::jsonb, DATE '2026-01-01', NULL),
  (gen_random_uuid(), 'kanuni_deger', 'binek_amortisman_siniri_vergili', '{"deger": 2100000}'::jsonb, DATE '2025-01-01', DATE '2025-12-31'),
  (gen_random_uuid(), 'kanuni_deger', 'binek_amortisman_siniri_vergili', '{"deger": 2600000}'::jsonb, DATE '2026-01-01', NULL);

INSERT INTO "mevzuat_olaylari" ("id", "olay", "detay") VALUES
  (gen_random_uuid(), 'ilk_dolum', '{"tur": "kanuni_deger", "anahtar": "dogrudan_gider_siniri", "kaynak": "VUK 313, 588 Sıra No VUK GT (RG 31.12.2025/33124): 2026 12.000", "kayit": 1, "yururlukBaslangic": "2026-01-01"}'::jsonb),
  (gen_random_uuid(), 'ilk_dolum', '{"tur": "kanuni_deger", "anahtar": "binek_amortisman_siniri", "kaynak": "GVK 40/5: 2025 1.100.000, 2026 1.380.000 (ÖTV/KDV hariç ilk iktisap)", "kayit": 2, "yururlukBaslangic": "2025-01-01"}'::jsonb),
  (gen_random_uuid(), 'ilk_dolum', '{"tur": "kanuni_deger", "anahtar": "binek_amortisman_siniri_vergili", "kaynak": "GVK 40/5: 2025 2.100.000, 2026 2.600.000 (vergiler maliyette / ikinci el)", "kayit": 2, "yururlukBaslangic": "2025-01-01"}'::jsonb);
