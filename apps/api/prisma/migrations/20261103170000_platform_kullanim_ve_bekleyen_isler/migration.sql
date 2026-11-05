BEGIN;
-- Kullanıma başlama, seçili bitiş tarihinde kapanmış son güne kadarki gözlemdir.
CREATE FUNCTION platform_kullanima_baslama(p_bit date, p_plan text, p_firma uuid, p_durum text, p_sayfa integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE v_gun date; v_son timestamp; v_bas date; v_yasam timestamp; v_hazir boolean; v_sonuc jsonb;
BEGIN
  IF p_bit IS NULL OR p_bit > (now() AT TIME ZONE 'Europe/Istanbul')::date OR p_bit < date '0001-01-01'
    OR p_durum IS NULL OR p_durum NOT IN ('baslamayan','baslayan','belirsiz') OR p_sayfa IS NULL OR p_sayfa NOT BETWEEN 1 AND 100000 OR length(p_plan) > 40 THEN
    RAISE EXCEPTION 'Gecersiz kullanima baslama filtresi';
  END IF;
  v_gun := least(p_bit, (now() AT TIME ZONE 'Europe/Istanbul')::date - 1);
  v_son := (v_gun + 1)::timestamp AT TIME ZONE 'Europe/Istanbul' AT TIME ZONE 'UTC';
  SELECT baslangic INTO STRICT v_bas FROM platform_istatistik_ayari WHERE id = 1;
  SELECT baslangic INTO STRICT v_yasam FROM platform_buyume_ayari WHERE id = 1;
  v_hazir := v_son > v_yasam AND v_gun >= v_bas;
  WITH son AS MATERIALIZED (
    SELECT DISTINCT ON (tenant_id) * FROM platform_firma_yasam_olaylari
    WHERE olay_at < v_son AND (p_firma IS NULL OR tenant_id = p_firma)
    ORDER BY tenant_id, olay_at DESC, id DESC
  ), kapsam AS MATERIALIZED (
    SELECT s.*, k.kayit, (k.kayit AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul')::date AS kayit_gunu
    FROM son s LEFT JOIN LATERAL (
      SELECT min(olay_at) AS kayit FROM platform_firma_yasam_olaylari r
      WHERE r.tenant_id = s.tenant_id AND r.tip = 'kayit' AND r.olay_at >= v_yasam
        AND NOT EXISTS (SELECT 1 FROM platform_firma_yasam_olaylari b WHERE b.tenant_id = s.tenant_id AND b.tip = 'baslangic')
    ) k ON true
    WHERE v_hazir AND s.mevcut AND (p_plan IS NULL OR s.plan_kodu = p_plan)
  ), siniflar AS MATERIALIZED (
    SELECT k.tenant_id, k.plan_kodu, k.kayit_gunu, o.son_etkin_gun,
      CASE WHEN o.son_etkin_gun IS NOT NULL THEN 'baslayan'
        WHEN k.kayit IS NOT NULL AND k.kayit_gunu >= v_bas AND k.kayit_gunu <= v_gun
          AND (SELECT count(*) FROM platform_istatistik_gunleri g
            JOIN platform_firma_gunluk_ozetleri d ON d.gun = g.gun AND d.tenant_id = k.tenant_id
            WHERE g.gun BETWEEN k.kayit_gunu AND v_gun AND g.surum = 1) = v_gun - k.kayit_gunu + 1
          THEN 'baslamayan' ELSE 'belirsiz' END AS durum
    FROM kapsam k LEFT JOIN LATERAL (
      SELECT max(d.gun) AS son_etkin_gun FROM platform_firma_gunluk_ozetleri d
        JOIN platform_istatistik_gunleri g ON g.gun = d.gun AND g.surum = 1
        WHERE d.tenant_id = k.tenant_id AND d.gun BETWEEN v_bas AND v_gun AND d.etkin_kullanici > 0
    ) o ON true
  ), secili AS (SELECT * FROM siniflar WHERE durum = p_durum),
  sayfa AS (SELECT * FROM secili ORDER BY tenant_id LIMIT 25 OFFSET (p_sayfa - 1) * 25)
  SELECT jsonb_build_object('kesimGunu', v_gun::text, 'hazir', v_hazir, 'olcumBaslangici', v_bas::text,
    'sonUretim', (SELECT max(uretildi_at) AT TIME ZONE 'UTC' FROM platform_istatistik_gunleri WHERE gun BETWEEN v_bas AND v_gun AND surum = 1),
    'sayilar', jsonb_build_object('baslayan', CASE WHEN v_hazir THEN (SELECT count(*) FROM siniflar WHERE durum = 'baslayan') END,
      'baslamayan', CASE WHEN v_hazir THEN (SELECT count(*) FROM siniflar WHERE durum = 'baslamayan') END,
      'belirsiz', CASE WHEN v_hazir THEN (SELECT count(*) FROM siniflar WHERE durum = 'belirsiz') END),
    'durum', p_durum, 'sayfa', p_sayfa, 'sayfaBoyutu', 25, 'toplam', CASE WHEN v_hazir THEN (SELECT count(*) FROM secili) END,
    'kayitlar', COALESCE((SELECT jsonb_agg(jsonb_build_object('tenantId', s.tenant_id, 'unvan', n.unvan, 'planKodu', s.plan_kodu,
      'kayitGunu', s.kayit_gunu::text, 'sonEtkinGun', s.son_etkin_gun::text) ORDER BY s.tenant_id)
      FROM sayfa s LEFT JOIN LATERAL platform_firma_adlari(ARRAY[s.tenant_id]) n ON true), '[]'::jsonb)) INTO v_sonuc;
  RETURN v_sonuc;
END $$;

-- Canlı operasyon kayıtlarıdır; Redis/BullMQ iş sayısı veya tarihsel stok değildir.
CREATE FUNCTION platform_bekleyen_isler(p_plan text, p_firma uuid, p_tur text, p_sayfa integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE v_sonuc jsonb;
BEGIN
  IF p_tur IS NULL OR p_tur NOT IN ('hepsi','gorev','fatura','iade') OR p_sayfa IS NULL OR p_sayfa NOT BETWEEN 1 AND 100000 OR length(p_plan) > 40 THEN
    RAISE EXCEPTION 'Gecersiz bekleyen is filtresi';
  END IF;
  WITH firmalar AS MATERIALIZED (
    SELECT tenant_id, unvan FROM platform_firma_ozeti() WHERE (p_plan IS NULL OR plan_kodu = p_plan) AND (p_firma IS NULL OR tenant_id = p_firma)
  ), isler AS MATERIALIZED (
    SELECT g.tenant_id, 'gorev' AS tur, false AS hatali FROM platform_gorevleri g JOIN firmalar f USING(tenant_id)
      WHERE g.kapsam = 'platform' AND g.durum IN ('acik','devam_ediyor') AND g.created_at <= (now() AT TIME ZONE 'UTC')
    UNION ALL
    SELECT a.odeyen_tenant_id, 'fatura', a.durum = 'hata' FROM abonelik_faturalari a JOIN firmalar f ON f.tenant_id = a.odeyen_tenant_id
      WHERE a.durum IN ('bekliyor','hata','kesinlesti') AND a.created_at <= (now() AT TIME ZONE 'UTC')
    UNION ALL
    SELECT i.tenant_id, 'iade', i.faturalayan_durumu = 'hata' FROM abonelik_iadeleri i JOIN firmalar f USING(tenant_id)
      WHERE i.faturalayan_durumu IN ('bekliyor','hata') AND i.created_at <= (now() AT TIME ZONE 'UTC')
  ), secili AS MATERIALIZED (SELECT * FROM isler WHERE p_tur = 'hepsi' OR tur = p_tur),
  ozetler AS (SELECT tenant_id, count(*) AS toplam, count(*) FILTER (WHERE tur = 'gorev') AS gorev,
    count(*) FILTER (WHERE tur = 'fatura') AS fatura, count(*) FILTER (WHERE tur = 'iade') AS iade, count(*) FILTER (WHERE hatali) AS hatali
    FROM secili GROUP BY tenant_id),
  sayfa AS (SELECT * FROM ozetler ORDER BY toplam DESC, tenant_id LIMIT 25 OFFSET (p_sayfa - 1) * 25)
  SELECT jsonb_build_object('zaman', now(), 'tur', p_tur, 'sayfa', p_sayfa, 'sayfaBoyutu', 25,
    'sayilar', (SELECT jsonb_build_object('toplam', count(*), 'gorev', count(*) FILTER (WHERE tur = 'gorev'),
      'fatura', count(*) FILTER (WHERE tur = 'fatura'), 'iade', count(*) FILTER (WHERE tur = 'iade'), 'hatali', count(*) FILTER (WHERE hatali)) FROM isler),
    'filtreliIs', (SELECT count(*) FROM secili), 'firmaToplam', (SELECT count(*) FROM ozetler),
    'kayitlar', COALESCE((SELECT jsonb_agg(to_jsonb(s) - 'tenant_id' || jsonb_build_object('tenantId', s.tenant_id, 'unvan', f.unvan) ORDER BY s.toplam DESC, s.tenant_id)
      FROM sayfa s JOIN firmalar f USING(tenant_id)), '[]'::jsonb)) INTO v_sonuc;
  RETURN v_sonuc;
END $$;
REVOKE ALL ON FUNCTION platform_kullanima_baslama(date,text,uuid,text,integer), platform_bekleyen_isler(text,uuid,text,integer) FROM PUBLIC, tekir_app;
GRANT EXECUTE ON FUNCTION platform_kullanima_baslama(date,text,uuid,text,integer), platform_bekleyen_isler(text,uuid,text,integer) TO tekir_platform;
COMMIT;
