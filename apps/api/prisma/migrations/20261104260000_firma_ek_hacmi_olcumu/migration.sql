BEGIN;
CREATE FUNCTION platform_firma_ek_hacmi(p_kullanici uuid,p_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM platform_kullanicilari WHERE id=p_kullanici AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN RAISE EXCEPTION 'kota_yetki'; END IF;
  IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=p_tenant) THEN RAISE EXCEPTION 'kota_firma_yok'; END IF;
  RETURN (WITH kaynak AS MATERIALIZED (SELECT sahip_tur,boyut FROM ekler WHERE tenant_id=p_tenant),
    gruplar AS (SELECT sahip_tur,count(*) AS adet,sum(boyut::bigint) AS bayt FROM kaynak GROUP BY sahip_tur)
    SELECT jsonb_build_object('tenantId',p_tenant,'olcumAt',statement_timestamp(),'dosyaAdedi',(SELECT count(*)::text FROM kaynak),
      'bayt',(SELECT COALESCE(sum(boyut::bigint),0)::text FROM kaynak),'kotaUygulaniyor',false,
      'dagilim',COALESCE((SELECT jsonb_agg(jsonb_build_object('sahipTur',sahip_tur,'dosyaAdedi',adet::text,'bayt',bayt::text) ORDER BY sahip_tur) FROM gruplar),'[]'::jsonb)));
END $$;
REVOKE ALL ON FUNCTION platform_firma_ek_hacmi(uuid,uuid) FROM PUBLIC,tekir_app;
GRANT EXECUTE ON FUNCTION platform_firma_ek_hacmi(uuid,uuid) TO tekir_platform;
COMMIT;
