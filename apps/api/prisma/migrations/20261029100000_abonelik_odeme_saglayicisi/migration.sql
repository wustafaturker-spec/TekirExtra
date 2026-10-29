-- PLT-11…15: abonelik bedelinin ödeme sağlayıcısıyla (iyzico / PayTR) tahsili.

-- PLT-11: sağlayıcı erişim bilgileri. Kiracı tablosu değildir; yalnız platform
-- rolü okur ve yazar (uygulama rolü gizli anahtarları göremez). Aynı anda tek
-- sağlayıcı etkindir.
CREATE TABLE abonelik_saglayici_ayarlari (
  saglayici VARCHAR(20) PRIMARY KEY CHECK (saglayici IN ('iyzico', 'paytr')),
  ortam VARCHAR(10) NOT NULL DEFAULT 'test' CHECK (ortam IN ('test', 'canli')),
  sifreli_config TEXT NOT NULL,
  etkin BOOLEAN NOT NULL DEFAULT false,
  guncelleyen_id UUID REFERENCES platform_kullanicilari(id),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX abonelik_saglayici_ayarlari_tek_etkin ON abonelik_saglayici_ayarlari (etkin) WHERE etkin;
REVOKE ALL ON abonelik_saglayici_ayarlari FROM tekir_app;
GRANT SELECT, INSERT, UPDATE ON abonelik_saglayici_ayarlari TO tekir_platform;

-- PLT-13: her ödeme girişimi (panel, e-posta bağlantısı, otomatik yenileme).
-- Başarılı girişim abonelik_odemeleri'ne bir satır üretir; tekrarlanan bildirim
-- aynı girişimi ikinci kez saymaz.
CREATE TABLE abonelik_odeme_denemeleri (
  id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  saglayici VARCHAR(20) NOT NULL,
  ortam VARCHAR(10) NOT NULL,
  kaynak VARCHAR(20) NOT NULL CHECK (kaynak IN ('panel', 'eposta', 'otomatik')),
  plan_kodu TEXT NOT NULL,
  ay_sayisi INTEGER NOT NULL CHECK (ay_sayisi IN (1, 3, 6, 12)),
  matrah DECIMAL(14,2) NOT NULL,
  kdv DECIMAL(14,2) NOT NULL,
  toplam DECIMAL(14,2) NOT NULL CHECK (toplam > 0),
  durum VARCHAR(20) NOT NULL DEFAULT 'baslatildi' CHECK (durum IN ('baslatildi', 'odendi', 'basarisiz')),
  saglayici_token VARCHAR(255),
  saglayici_odeme_id VARCHAR(100),
  odeme_sayfasi_url TEXT,
  hata_mesaji VARCHAR(500),
  kart_kaydet BOOLEAN NOT NULL DEFAULT false,
  baslatan_user_id UUID,
  abonelik_odemesi_id UUID,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sonuclandi_at TIMESTAMP(3),
  CONSTRAINT abonelik_odeme_denemeleri_pkey PRIMARY KEY (id)
);
CREATE INDEX abonelik_odeme_denemeleri_tenant_id_created_at_idx ON abonelik_odeme_denemeleri (tenant_id, created_at);
CREATE UNIQUE INDEX abonelik_odeme_denemeleri_saglayici_odeme_key ON abonelik_odeme_denemeleri (saglayici, saglayici_odeme_id);
ALTER TABLE abonelik_odeme_denemeleri ADD CONSTRAINT abonelik_odeme_denemeleri_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE abonelik_odeme_denemeleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE abonelik_odeme_denemeleri FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON abonelik_odeme_denemeleri USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Sağlayıcıdan gelen ödeme platform kullanıcısı olmadan kaydedilir.
ALTER TABLE abonelik_odemeleri ALTER COLUMN platform_kullanici_id DROP NOT NULL;
ALTER TABLE abonelik_odemeleri ADD COLUMN kaynak VARCHAR(20) NOT NULL DEFAULT 'elle' CHECK (kaynak IN ('elle', 'saglayici'));
ALTER TABLE abonelik_odemeleri ADD COLUMN saglayici VARCHAR(20);
ALTER TABLE abonelik_odemeleri ADD COLUMN matrah DECIMAL(14,2);
ALTER TABLE abonelik_odemeleri ADD COLUMN kdv DECIMAL(14,2);
ALTER TABLE abonelik_odemeleri ADD CONSTRAINT abonelik_odemeleri_kaynak_kullanici_check CHECK (kaynak = 'saglayici' OR platform_kullanici_id IS NOT NULL);
ALTER TABLE abonelik_odeme_denemeleri ADD CONSTRAINT abonelik_odeme_denemeleri_abonelik_odemesi_id_fkey FOREIGN KEY (abonelik_odemesi_id) REFERENCES abonelik_odemeleri(id) ON DELETE SET NULL;

-- PLT-13: ödeme yapılmadığı için askıya alınan firma başarılı ödemeyle açılır;
-- başka nedenle askıdaki firma açılmaz.
ALTER TABLE tenant_abonelikleri ADD COLUMN aski_nedeni VARCHAR(20) CHECK (aski_nedeni IN ('odeme', 'diger'));

DROP FUNCTION platform_abonelik_guncelle(uuid, text, text, text);
CREATE FUNCTION platform_abonelik_guncelle(p_tenant uuid, p_plan text, p_durum text, p_neden text, p_aski_nedeni text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE
  eski tenant_abonelikleri%ROWTYPE;
  yeni_plan text;
  yeni_durum "AbonelikDurumu";
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant) THEN
    RAISE EXCEPTION 'firma_yok' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO tenant_abonelikleri (id, tenant_id, plan_kodu, durum, created_at, updated_at)
  VALUES (gen_random_uuid(), p_tenant, 'v1', 'aktif', now(), now())
  ON CONFLICT (tenant_id) DO NOTHING;
  SELECT * INTO eski FROM tenant_abonelikleri WHERE tenant_id = p_tenant FOR UPDATE;
  yeni_plan := COALESCE(p_plan, eski.plan_kodu);
  yeni_durum := COALESCE(p_durum, eski.durum::text)::"AbonelikDurumu";
  UPDATE tenant_abonelikleri SET
    plan_kodu = yeni_plan,
    durum = yeni_durum,
    donem_baslangici = CASE WHEN p_plan IS NOT NULL THEN now() ELSE donem_baslangici END,
    donem_sonu = CASE WHEN p_plan IS NOT NULL THEN now() + interval '1 month' ELSE donem_sonu END,
    iptal_tarihi = CASE WHEN yeni_durum = 'aktif' THEN NULL ELSE iptal_tarihi END,
    aski_nedeni = CASE WHEN yeni_durum = 'askida' THEN COALESCE(p_aski_nedeni, aski_nedeni, 'diger') ELSE NULL END,
    updated_at = now()
  WHERE tenant_id = p_tenant;
  INSERT INTO abonelik_degisiklikleri (id, tenant_id, onceki_plan, yeni_plan, onceki_durum, yeni_durum, neden, created_at)
  VALUES (gen_random_uuid(), p_tenant, eski.plan_kodu, yeni_plan, eski.durum, yeni_durum, p_neden, now());
END;
$$;
REVOKE ALL ON FUNCTION platform_abonelik_guncelle(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_abonelik_guncelle(uuid, text, text, text, text) TO tekir_platform;

-- PLT-15: geçmişe ödeme kaynağı, KDV kırılımı, başarısız denemeler ve askı nedeni.
CREATE OR REPLACE FUNCTION platform_firma_abonelik_gecmisi(p_tenant uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT jsonb_build_object(
    'degisiklikler', COALESCE((SELECT jsonb_agg(jsonb_build_object('zaman', d.created_at, 'oncekiPlan', d.onceki_plan, 'yeniPlan', d.yeni_plan, 'oncekiDurum', d.onceki_durum, 'yeniDurum', d.yeni_durum, 'neden', d.neden) ORDER BY d.created_at DESC)
                               FROM abonelik_degisiklikleri d WHERE d.tenant_id = p_tenant), '[]'::jsonb),
    'talepler', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'zaman', r.created_at, 'mevcutPlan', r.mevcut_plan, 'istenenPlan', r.istenen_plan, 'durum', r.durum, 'aciklama', r.aciklama, 'kararNotu', r.karar_notu, 'kararAt', r.karar_at) ORDER BY r.created_at DESC)
                          FROM abonelik_talepleri r WHERE r.tenant_id = p_tenant), '[]'::jsonb),
    'odemeler', COALESCE((SELECT jsonb_agg(jsonb_build_object('zaman', o.created_at, 'aySayisi', o.ay_sayisi, 'tutar', o.tutar, 'matrah', o.matrah, 'kdv', o.kdv, 'kaynak', o.kaynak, 'saglayici', o.saglayici, 'not', o."not", 'oncekiDonemSonu', o.onceki_donem_sonu, 'yeniDonemSonu', o.yeni_donem_sonu) ORDER BY o.created_at DESC)
                          FROM abonelik_odemeleri o WHERE o.tenant_id = p_tenant), '[]'::jsonb),
    'basarisizDenemeler', COALESCE((SELECT jsonb_agg(jsonb_build_object('zaman', x.created_at, 'saglayici', x.saglayici, 'kaynak', x.kaynak, 'aySayisi', x.ay_sayisi, 'toplam', x.toplam, 'hata', x.hata_mesaji) ORDER BY x.created_at DESC)
                          FROM (SELECT * FROM abonelik_odeme_denemeleri x WHERE x.tenant_id = p_tenant AND x.durum = 'basarisiz' ORDER BY x.created_at DESC LIMIT 20) x), '[]'::jsonb),
    'askiNedeni', (SELECT a.aski_nedeni FROM tenant_abonelikleri a WHERE a.tenant_id = p_tenant)
  );
$$;
