-- Aynı kaynak ve kapsam: istatistik toplamı ile sayfalı ödeme ayrıntısı.
CREATE FUNCTION platform_sorunlu_odeme_kapsami(p_bas date, p_bit date, p_plan text, p_firma uuid, p_durum text, p_sayfa integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
BEGIN
  IF p_bas IS NULL OR p_bit IS NULL OR p_bit < p_bas OR p_bit > p_bas + interval '24 months'
    OR p_durum IS NULL OR p_durum NOT IN ('hepsi','basarisiz','sonuclanmadi')
    OR p_sayfa IS NULL OR p_sayfa < 1 OR p_sayfa > 100000 THEN
    RAISE EXCEPTION 'gecersiz_filtre' USING ERRCODE = 'P0001';
  END IF;
  RETURN (
    WITH firmalar AS MATERIALIZED (
      SELECT tenant_id FROM platform_firma_ozeti()
      WHERE (p_plan IS NULL OR plan_kodu = p_plan) AND (p_firma IS NULL OR tenant_id = p_firma)
    ), kaynak AS MATERIALIZED (
      SELECT d.id AS deneme_id, d.tenant_id, t.unvan::text, d.created_at AS zaman,
        d.saglayici::text, d.ortam::text, d.kaynak::text, d.ay_sayisi, d.toplam,
        CASE WHEN d.durum = 'basarisiz' THEN 'basarisiz' ELSE 'sonuclanmadi' END AS durum,
        d.hata_mesaji::text AS hata
      FROM abonelik_odeme_denemeleri d JOIN firmalar f ON f.tenant_id = d.tenant_id
      JOIN tenants t ON t.id = d.tenant_id
      WHERE d.created_at >= (p_bas::timestamp AT TIME ZONE 'Europe/Istanbul' AT TIME ZONE 'UTC')
        AND d.created_at < ((p_bit + 1)::timestamp AT TIME ZONE 'Europe/Istanbul' AT TIME ZONE 'UTC')
        AND d.created_at <= (now() AT TIME ZONE 'UTC')
        AND (d.durum = 'basarisiz' OR (d.durum = 'baslatildi' AND d.created_at < (now() AT TIME ZONE 'UTC') - interval '1 hour'))
    ), filtreli AS (SELECT * FROM kaynak WHERE p_durum = 'hepsi' OR durum = p_durum),
    sayfa AS (SELECT * FROM filtreli ORDER BY zaman DESC, deneme_id ASC LIMIT 50 OFFSET (p_sayfa - 1) * 50)
    SELECT jsonb_build_object(
      'baslangic', p_bas, 'bitis', p_bit, 'zaman', now(),
      'sayilar', (SELECT jsonb_build_object('basarisiz', count(*) FILTER (WHERE durum = 'basarisiz'),
        'sonuclanmadi', count(*) FILTER (WHERE durum = 'sonuclanmadi')) FROM kaynak),
      'toplam', (SELECT count(*) FROM filtreli), 'sayfa', p_sayfa, 'sayfaBoyutu', 50,
      'denemeler', COALESCE((SELECT jsonb_agg(to_jsonb(s) || jsonb_build_object('zaman', s.zaman AT TIME ZONE 'UTC') ORDER BY zaman DESC, deneme_id ASC) FROM sayfa s), '[]'::jsonb))
  );
END;
$$;
REVOKE ALL ON FUNCTION platform_sorunlu_odeme_kapsami(date,date,text,uuid,text,integer) FROM PUBLIC, tekir_app;
GRANT EXECUTE ON FUNCTION platform_sorunlu_odeme_kapsami(date,date,text,uuid,text,integer) TO tekir_platform;
