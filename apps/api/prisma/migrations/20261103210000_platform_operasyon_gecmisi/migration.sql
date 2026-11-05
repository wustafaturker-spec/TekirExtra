BEGIN;
-- Her günün son başarılı gözlemi. Geçmiş günler bugünkü durumla doldurulmaz.
CREATE TABLE platform_operasyon_gunleri (
  gun date PRIMARY KEY, gozlem_at timestamp(3) NOT NULL, firma_adet integer NOT NULL CHECK (firma_adet >= 0),
  surum integer NOT NULL DEFAULT 1
);
CREATE TABLE platform_operasyon_ozetleri (
  gun date NOT NULL, tenant_id uuid NOT NULL, plan_kodu text NOT NULL, durum text NOT NULL,
  geciken boolean NOT NULL, yaklasan boolean NOT NULL, baglanti_hatali boolean NOT NULL,
  gorev integer NOT NULL, fatura integer NOT NULL, iade integer NOT NULL, hatali integer NOT NULL,
  PRIMARY KEY (gun, tenant_id)
);
CREATE INDEX platform_operasyon_ozetleri_plan_idx ON platform_operasyon_ozetleri(gun, plan_kodu);
REVOKE ALL ON platform_operasyon_gunleri, platform_operasyon_ozetleri FROM PUBLIC, tekir_app, tekir_platform;
ALTER TABLE platform_operasyon_gunleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_operasyon_gunleri FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_operasyon_ozetleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_operasyon_ozetleri FORCE ROW LEVEL SECURITY;
CREATE POLICY kapali ON platform_operasyon_gunleri USING (false) WITH CHECK (false);
CREATE POLICY kapali ON platform_operasyon_ozetleri USING (false) WITH CHECK (false);

CREATE FUNCTION platform_operasyon_gozle() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE v_an timestamp := clock_timestamp() AT TIME ZONE 'UTC'; v_gun date;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('platform-operasyon-gozlem', 0)) THEN RETURN false; END IF;
  v_gun := (v_an AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul')::date;
  DELETE FROM platform_operasyon_ozetleri WHERE gun = v_gun;
  WITH firmalar AS MATERIALIZED (SELECT * FROM platform_firma_ozeti()),
  isler AS (
    SELECT g.tenant_id, 'gorev' AS tur, false AS hatali FROM platform_gorevleri g
      WHERE g.kapsam = 'platform' AND g.durum IN ('acik','devam_ediyor') AND g.created_at <= v_an
    UNION ALL
    SELECT a.odeyen_tenant_id, 'fatura', a.durum = 'hata' FROM abonelik_faturalari a
      WHERE a.durum IN ('bekliyor','hata','kesinlesti') AND a.created_at <= v_an
    UNION ALL
    SELECT i.tenant_id, 'iade', i.faturalayan_durumu = 'hata' FROM abonelik_iadeleri i
      WHERE i.faturalayan_durumu IN ('bekliyor','hata') AND i.created_at <= v_an
  ), sayilar AS (
    SELECT tenant_id, count(*) FILTER (WHERE tur = 'gorev')::integer AS gorev,
      count(*) FILTER (WHERE tur = 'fatura')::integer AS fatura, count(*) FILTER (WHERE tur = 'iade')::integer AS iade,
      count(*) FILTER (WHERE hatali)::integer AS hatali FROM isler GROUP BY tenant_id
  ), hatali AS (SELECT DISTINCT tenant_id FROM platform_baglanti_sagligi()),
  yazilan AS (
    INSERT INTO platform_operasyon_ozetleri
    SELECT v_gun, f.tenant_id, f.plan_kodu, f.durum::text, f.askiya_alinacak,
      COALESCE(f.durum IN ('aktif','deneme') AND (f.donem_sonu AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul')::date BETWEEN v_gun AND v_gun + 7, false),
      h.tenant_id IS NOT NULL, COALESCE(s.gorev,0), COALESCE(s.fatura,0), COALESCE(s.iade,0), COALESCE(s.hatali,0)
    FROM firmalar f LEFT JOIN sayilar s USING (tenant_id) LEFT JOIN hatali h USING (tenant_id)
    RETURNING tenant_id
  )
  INSERT INTO platform_operasyon_gunleri(gun, gozlem_at, firma_adet)
    SELECT v_gun, v_an, count(*)::integer FROM yazilan
    ON CONFLICT (gun) DO UPDATE SET gozlem_at = EXCLUDED.gozlem_at, firma_adet = EXCLUDED.firma_adet, surum = 1;
  RETURN true;
END $$;

-- Okuma işlevi her tarih için tam gözlemi kontrol eder; eksik firma satırı sıfır değildir.
CREATE FUNCTION platform_operasyon_gecmisi(p_bas date, p_bit date, p_plan text, p_firma uuid, p_gun date, p_sayfa integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE v_bugun date := (now() AT TIME ZONE 'Europe/Istanbul')::date; v_onceki date;
BEGIN
  IF p_bas IS NULL OR p_bit IS NULL OR p_bit < p_bas OR p_bit - p_bas >= 93 OR p_bit > v_bugun
    OR p_gun IS NULL OR p_gun < p_bas OR p_gun > p_bit
    OR p_sayfa IS NULL OR p_sayfa NOT BETWEEN 1 AND 100000 OR length(p_plan) > 40 THEN
    RAISE EXCEPTION 'Gecersiz operasyon gecmis filtresi';
  END IF;
  v_onceki := p_bas - (p_bit - p_bas + 1);
  RETURN (
    WITH gunler AS MATERIALIZED (
      SELECT d::date AS gun, g.gozlem_at,
        COALESCE(g.surum = 1 AND g.firma_adet = (SELECT count(*) FROM platform_operasyon_ozetleri o WHERE o.gun = d::date), false) AS hazir
      FROM generate_series(v_onceki::timestamp, p_bit::timestamp, interval '1 day') d
      LEFT JOIN platform_operasyon_gunleri g ON g.gun = d::date
    ), kapsam AS MATERIALIZED (
      SELECT o.* FROM platform_operasyon_ozetleri o JOIN gunler g USING(gun)
      WHERE g.hazir AND (p_plan IS NULL OR o.plan_kodu = p_plan) AND (p_firma IS NULL OR o.tenant_id = p_firma)
    ), gunluk AS MATERIALIZED (
      SELECT g.gun, g.hazir, g.gozlem_at,
        CASE WHEN g.hazir THEN jsonb_build_object('firma', count(o.tenant_id),
          'aktif', count(*) FILTER (WHERE o.durum = 'aktif'), 'deneme', count(*) FILTER (WHERE o.durum = 'deneme'),
          'askida', count(*) FILTER (WHERE o.durum = 'askida'), 'iptal', count(*) FILTER (WHERE o.durum = 'iptal'),
          'geciken', count(*) FILTER (WHERE o.geciken), 'yaklasan', count(*) FILTER (WHERE o.yaklasan),
          'baglantiHatali', count(*) FILTER (WHERE o.baglanti_hatali),
          'gorev', COALESCE(sum(o.gorev),0), 'fatura', COALESCE(sum(o.fatura),0), 'iade', COALESCE(sum(o.iade),0),
          'hatali', COALESCE(sum(o.hatali),0), 'toplam', COALESCE(sum(o.gorev::bigint + o.fatura + o.iade),0)) END AS sayilar
      FROM gunler g LEFT JOIN kapsam o USING(gun) GROUP BY g.gun, g.hazir, g.gozlem_at
    ), detay AS MATERIALIZED (
      SELECT o.*, o.gorev::bigint + o.fatura + o.iade AS toplam FROM kapsam o WHERE o.gun = p_gun
    ), sayfa AS (SELECT * FROM detay ORDER BY toplam DESC, tenant_id LIMIT 25 OFFSET (p_sayfa - 1) * 25)
    SELECT jsonb_build_object('olcumBaslangici', (SELECT min(gun)::text FROM platform_operasyon_gunleri WHERE surum = 1),
      'gunler', (SELECT jsonb_agg(jsonb_build_object('gun', gun::text, 'hazir', hazir, 'gecici', gun = v_bugun,
        'gozlemAt', gozlem_at AT TIME ZONE 'UTC', 'sayilar', sayilar) ORDER BY gun) FROM gunluk WHERE gun >= p_bas),
      'donemSonu', (SELECT sayilar FROM gunluk WHERE gun = p_bit),
      'oncekiDonemSonu', (SELECT sayilar FROM gunluk WHERE gun = p_bas - 1),
      'oncekiBitis', (p_bas - 1)::text,
      'detay', jsonb_build_object('gun', p_gun::text, 'hazir', (SELECT hazir FROM gunluk WHERE gun = p_gun),
        'gozlemAt', (SELECT gozlem_at AT TIME ZONE 'UTC' FROM gunluk WHERE gun = p_gun),
        'sayilar', (SELECT sayilar FROM gunluk WHERE gun = p_gun),
        'toplam', CASE WHEN (SELECT hazir FROM gunluk WHERE gun = p_gun) THEN (SELECT count(*) FROM detay) END,
        'sayfa', p_sayfa, 'sayfaBoyutu', 25,
        'kayitlar', COALESCE((SELECT jsonb_agg(jsonb_build_object('tenantId', s.tenant_id, 'unvan', n.unvan, 'planKodu', s.plan_kodu,
          'durum', s.durum, 'geciken', s.geciken, 'yaklasan', s.yaklasan, 'baglantiHatali', s.baglanti_hatali,
          'gorev', s.gorev, 'fatura', s.fatura, 'iade', s.iade, 'hatali', s.hatali, 'toplam', s.toplam) ORDER BY s.toplam DESC, s.tenant_id)
          FROM sayfa s LEFT JOIN LATERAL platform_firma_adlari(ARRAY[s.tenant_id]) n ON true), '[]'::jsonb)))
  );
END $$;
REVOKE ALL ON FUNCTION platform_operasyon_gozle(), platform_operasyon_gecmisi(date,date,text,uuid,date,integer) FROM PUBLIC, tekir_app;
GRANT EXECUTE ON FUNCTION platform_operasyon_gozle(), platform_operasyon_gecmisi(date,date,text,uuid,date,integer) TO tekir_platform;
COMMIT;
