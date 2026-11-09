-- ILT-08: platform ekranı için firma başına yalnız sayılar; alıcı, konu ve hata metni dönmez.
CREATE FUNCTION platform_ileti_firma_sayilari(p_gun integer)
RETURNS TABLE (tenant_id uuid, firma text, sistem_toplam integer, sistem_hata integer, eposta_toplam integer, eposta_hata integer, sms_toplam integer, sms_hata integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  WITH sinir AS (SELECT (now() AT TIME ZONE 'UTC') - make_interval(days => GREATEST(1, LEAST(p_gun, 90))) AS bas),
  sistem AS (
    SELECT k.tenant_id, count(*)::integer AS toplam, count(*) FILTER (WHERE k.durum IN ('basarisiz', 'belirsiz'))::integer AS hata
    FROM platform_ileti_kayitlari k, sinir WHERE k.tenant_id IS NOT NULL AND k.created_at >= sinir.bas GROUP BY k.tenant_id
  ), eposta AS (
    SELECT e.tenant_id, count(*)::integer AS toplam, count(*) FILTER (WHERE e.durum IN ('basarisiz', 'belirsiz'))::integer AS hata
    FROM eposta_gonderimleri e, sinir WHERE e.created_at >= sinir.bas GROUP BY e.tenant_id
  ), sms AS (
    SELECT s.tenant_id, count(*)::integer AS toplam, count(*) FILTER (WHERE s.durum IN ('basarisiz', 'belirsiz'))::integer AS hata
    FROM sms_gonderimleri s, sinir WHERE s.created_at >= sinir.bas GROUP BY s.tenant_id
  )
  SELECT t.id, t.unvan::text, COALESCE(si.toplam, 0), COALESCE(si.hata, 0), COALESCE(e.toplam, 0), COALESCE(e.hata, 0), COALESCE(sm.toplam, 0), COALESCE(sm.hata, 0)
  FROM tenants t
    LEFT JOIN sistem si ON si.tenant_id = t.id
    LEFT JOIN eposta e ON e.tenant_id = t.id
    LEFT JOIN sms sm ON sm.tenant_id = t.id
  WHERE si.tenant_id IS NOT NULL OR e.tenant_id IS NOT NULL OR sm.tenant_id IS NOT NULL
  ORDER BY COALESCE(si.hata, 0) + COALESCE(e.hata, 0) + COALESCE(sm.hata, 0) DESC, COALESCE(si.toplam, 0) + COALESCE(e.toplam, 0) + COALESCE(sm.toplam, 0) DESC, t.id
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION platform_ileti_firma_sayilari(integer) FROM PUBLIC, tekir_app;
GRANT EXECUTE ON FUNCTION platform_ileti_firma_sayilari(integer) TO tekir_platform;
