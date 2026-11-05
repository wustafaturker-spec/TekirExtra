CREATE TABLE platform_istatistik_ayari (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  baslangic DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Istanbul')::date
);
INSERT INTO platform_istatistik_ayari (id) VALUES (1);
CREATE TABLE platform_istatistik_gunleri (
  gun DATE PRIMARY KEY,
  uretildi_at TIMESTAMP(3) NOT NULL,
  surum INTEGER NOT NULL DEFAULT 1
);
-- Tarihsel özetler firma silinse de sayısal geçmişi korur; içerik/kullanıcı kimliği içermez.
CREATE TABLE platform_firma_gunluk_ozetleri (
  tenant_id UUID NOT NULL,
  gun DATE NOT NULL,
  plan_kodu VARCHAR(40),
  durum VARCHAR(20),
  etkin_kullanici INTEGER NOT NULL DEFAULT 0,
  giris INTEGER NOT NULL DEFAULT 0,
  islem INTEGER NOT NULL DEFAULT 0,
  moduller JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, gun)
);
CREATE INDEX platform_firma_gunluk_ozetleri_gun_plan_idx ON platform_firma_gunluk_ozetleri(gun, plan_kodu);
-- Dönemsel tekil sayım için iç izler. Platform DB rolüne dahi doğrudan SELECT verilmez.
CREATE TABLE platform_firma_gunluk_kullanicilar (
  tenant_id UUID NOT NULL,
  gun DATE NOT NULL,
  kullanici_izi VARCHAR(32) NOT NULL,
  PRIMARY KEY (tenant_id, gun, kullanici_izi)
);
CREATE INDEX platform_firma_gunluk_kullanicilar_gun_idx ON platform_firma_gunluk_kullanicilar(gun);

REVOKE ALL ON platform_istatistik_ayari, platform_istatistik_gunleri, platform_firma_gunluk_ozetleri, platform_firma_gunluk_kullanicilar FROM PUBLIC, tekir_app, tekir_platform;
GRANT SELECT ON platform_istatistik_ayari, platform_istatistik_gunleri, platform_firma_gunluk_ozetleri TO tekir_platform;
ALTER TABLE platform_istatistik_ayari ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_istatistik_ayari FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_okuma ON platform_istatistik_ayari FOR SELECT TO tekir_platform USING (true);
ALTER TABLE platform_istatistik_gunleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_istatistik_gunleri FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_okuma ON platform_istatistik_gunleri FOR SELECT TO tekir_platform USING (true);
ALTER TABLE platform_firma_gunluk_ozetleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_firma_gunluk_ozetleri FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_okuma ON platform_firma_gunluk_ozetleri FOR SELECT TO tekir_platform USING (true);
ALTER TABLE platform_firma_gunluk_kullanicilar ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_firma_gunluk_kullanicilar FORCE ROW LEVEL SECURITY;
CREATE POLICY kapali ON platform_firma_gunluk_kullanicilar USING (false) WITH CHECK (false);

CREATE FUNCTION platform_firma_istatistik_uret(p_gun date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE v_baslangic date; v_bugun date := (now() AT TIME ZONE 'Europe/Istanbul')::date; v_adet integer;
BEGIN
  SELECT baslangic INTO STRICT v_baslangic FROM platform_istatistik_ayari WHERE id = 1;
  IF p_gun IS NULL OR p_gun < v_baslangic OR p_gun > v_bugun THEN
    RAISE EXCEPTION 'Olcum baslangici ile bugun arasinda bir gun secin';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('platform-istatistik:' || p_gun::text, 0)) THEN RETURN NULL; END IF;
  DELETE FROM platform_firma_gunluk_kullanicilar WHERE gun = p_gun;
  WITH olaylar AS (
    SELECT tenant_id, user_id, islem, CASE WHEN islem = 'giris_yapildi' THEN NULL ELSE varlik END AS modul
    FROM audit_log
    WHERE created_at >= (p_gun::timestamp AT TIME ZONE 'Europe/Istanbul' AT TIME ZONE 'UTC')
      AND created_at < ((p_gun + 1)::timestamp AT TIME ZONE 'Europe/Istanbul' AT TIME ZONE 'UTC')
      AND user_id IS NOT NULL
      AND user_id NOT IN ('00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-4000-8000-000000000000'::uuid)
      AND (islem = 'giris_yapildi' OR (islem ~ '^(POST|PUT|PATCH|DELETE) /api/v1/' AND varlik IN
        ('fatura','cari','stok','depo','kasa-banka','pos','personel','uretim','projeler','ai','baglantilar','rapor','belgeler','satin-alma','satis')))
  ), kullanicilar AS (
    INSERT INTO platform_firma_gunluk_kullanicilar(tenant_id, gun, kullanici_izi)
    SELECT DISTINCT tenant_id, p_gun, md5(tenant_id::text || ':' || user_id::text) FROM olaylar RETURNING tenant_id
  ), sayilar AS (
    SELECT tenant_id, count(DISTINCT user_id)::integer AS etkin,
      count(*) FILTER (WHERE islem = 'giris_yapildi')::integer AS giris,
      count(*) FILTER (WHERE modul IS NOT NULL)::integer AS islem
    FROM olaylar GROUP BY tenant_id
  ), moduller AS (
    SELECT tenant_id, jsonb_object_agg(modul, adet) AS deger FROM
      (SELECT tenant_id, modul, count(*) AS adet FROM olaylar WHERE modul IS NOT NULL GROUP BY tenant_id, modul) m GROUP BY tenant_id
  ), firmalar AS (
    SELECT t.id, CASE WHEN p_gun = v_bugun THEN COALESCE(a.plan_kodu, 'v1') END AS plan,
      CASE WHEN p_gun = v_bugun THEN COALESCE(a.durum::text, 'aktif') END AS durum
    FROM tenants t LEFT JOIN tenant_abonelikleri a ON a.tenant_id = t.id
    WHERE (t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul')::date <= p_gun
    UNION ALL
    SELECT o.tenant_id, NULL, NULL FROM platform_firma_gunluk_ozetleri o
      WHERE o.gun = p_gun AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = o.tenant_id)
  )
  INSERT INTO platform_firma_gunluk_ozetleri(tenant_id, gun, plan_kodu, durum, etkin_kullanici, giris, islem, moduller)
    SELECT f.id, p_gun, f.plan, f.durum, COALESCE(s.etkin,0), COALESCE(s.giris,0), COALESCE(s.islem,0), COALESCE(m.deger,'{}'::jsonb)
    FROM firmalar f LEFT JOIN sayilar s ON s.tenant_id = f.id LEFT JOIN moduller m ON m.tenant_id = f.id
    ON CONFLICT (tenant_id, gun) DO UPDATE SET
      plan_kodu = COALESCE(EXCLUDED.plan_kodu, platform_firma_gunluk_ozetleri.plan_kodu),
      durum = COALESCE(EXCLUDED.durum, platform_firma_gunluk_ozetleri.durum),
      etkin_kullanici = EXCLUDED.etkin_kullanici, giris = EXCLUDED.giris, islem = EXCLUDED.islem, moduller = EXCLUDED.moduller;
  GET DIAGNOSTICS v_adet = ROW_COUNT;
  INSERT INTO platform_istatistik_gunleri(gun, uretildi_at) VALUES (p_gun, now() AT TIME ZONE 'UTC')
    ON CONFLICT (gun) DO UPDATE SET uretildi_at = EXCLUDED.uretildi_at, surum = 1;
  RETURN v_adet;
END $$;

CREATE FUNCTION platform_istatistik_tekil_kullanici(p_bas date, p_bit date, p_plan text, p_firma uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT count(DISTINCT k.kullanici_izi) FROM platform_firma_gunluk_kullanicilar k
    JOIN platform_firma_gunluk_ozetleri o ON o.tenant_id = k.tenant_id AND o.gun = k.gun
    JOIN platform_istatistik_gunleri g ON g.gun = k.gun AND g.surum = 1
    JOIN platform_istatistik_ayari a ON a.id = 1
    WHERE k.gun BETWEEN p_bas AND p_bit AND k.gun >= a.baslangic AND (p_plan IS NULL OR o.plan_kodu = p_plan) AND (p_firma IS NULL OR k.tenant_id = p_firma);
$$;

CREATE FUNCTION platform_istatistik_guncel(p_plan text, p_firma uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  WITH firmalar AS MATERIALIZED (SELECT * FROM platform_firma_ozeti() WHERE (p_plan IS NULL OR plan_kodu = p_plan) AND (p_firma IS NULL OR tenant_id = p_firma)),
  hatali AS (SELECT DISTINCT tenant_id FROM platform_baglanti_sagligi())
  SELECT jsonb_build_object('zaman', now(), 'toplam', count(*),
    'aktif', count(*) FILTER (WHERE durum = 'aktif'), 'deneme', count(*) FILTER (WHERE durum = 'deneme'),
    'askida', count(*) FILTER (WHERE durum = 'askida'), 'iptal', count(*) FILTER (WHERE durum = 'iptal'),
    'geciken', count(*) FILTER (WHERE askiya_alinacak), 'talep', count(*) FILTER (WHERE bekleyen_talep_id IS NOT NULL),
    'yaklasan', count(*) FILTER (WHERE durum IN ('aktif','deneme') AND (donem_sonu AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul')::date
      BETWEEN (now() AT TIME ZONE 'Europe/Istanbul')::date AND (now() AT TIME ZONE 'Europe/Istanbul')::date + 7),
    'baglantiHatali', (SELECT count(*) FROM hatali h JOIN firmalar f ON f.tenant_id = h.tenant_id),
    'basarisizOdeme7Gun', (SELECT count(*) FROM abonelik_odeme_denemeleri d JOIN firmalar f ON f.tenant_id = d.tenant_id
      WHERE d.durum = 'basarisiz' AND d.created_at >= (((now() AT TIME ZONE 'Europe/Istanbul')::date - 6)::timestamp AT TIME ZONE 'Europe/Istanbul' AT TIME ZONE 'UTC')
        AND d.created_at <= (now() AT TIME ZONE 'UTC')),
    'planlar', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.kod) FROM (SELECT plan_kodu AS kod, count(*) AS adet FROM firmalar GROUP BY plan_kodu) p), '[]'::jsonb))
  FROM firmalar;
$$;

REVOKE ALL ON FUNCTION platform_firma_istatistik_uret(date), platform_istatistik_tekil_kullanici(date,date,text,uuid), platform_istatistik_guncel(text,uuid) FROM PUBLIC, tekir_app;
GRANT EXECUTE ON FUNCTION platform_firma_istatistik_uret(date), platform_istatistik_tekil_kullanici(date,date,text,uuid), platform_istatistik_guncel(text,uuid) TO tekir_platform;
