BEGIN;
-- Approval/cancellation must invalidate a Repeatable Read writer's old quota
-- snapshot as well as serialize with ordinary writes on the subscription row.
ALTER FUNCTION platform_firma_ozel_fiyat_onay(uuid,uuid,uuid) RENAME TO platform_firma_istisna_onay_ic;
REVOKE ALL ON FUNCTION platform_firma_istisna_onay_ic(uuid,uuid,uuid) FROM PUBLIC,tekir_app,tekir_platform;
CREATE FUNCTION platform_firma_ozel_fiyat_onay(p_kullanici uuid,p_tenant uuid,p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE degisti boolean;
BEGIN
  degisti:=platform_firma_istisna_onay_ic(p_kullanici,p_tenant,p_id);
  IF degisti THEN UPDATE tenant_abonelikleri SET kota_surumu=gen_random_uuid() WHERE tenant_id=p_tenant; END IF;
  RETURN degisti;
END $$;
REVOKE ALL ON FUNCTION platform_firma_ozel_fiyat_onay(uuid,uuid,uuid) FROM PUBLIC,tekir_app;
GRANT EXECUTE ON FUNCTION platform_firma_ozel_fiyat_onay(uuid,uuid,uuid) TO tekir_platform;

ALTER FUNCTION platform_firma_istisna_taslak_iptal(uuid,uuid,uuid,text) RENAME TO platform_firma_istisna_iptal_ic;
REVOKE ALL ON FUNCTION platform_firma_istisna_iptal_ic(uuid,uuid,uuid,text) FROM PUBLIC,tekir_app,tekir_platform;
CREATE FUNCTION platform_firma_istisna_taslak_iptal(p_kullanici uuid,p_tenant uuid,p_id uuid,p_neden text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE degisti boolean;
BEGIN
  degisti:=platform_firma_istisna_iptal_ic(p_kullanici,p_tenant,p_id,p_neden);
  IF degisti AND EXISTS(SELECT 1 FROM platform_firma_istisna_taslaklari WHERE id=p_id AND onay_at IS NOT NULL) THEN
    UPDATE tenant_abonelikleri SET kota_surumu=gen_random_uuid() WHERE tenant_id=p_tenant;
  END IF;
  RETURN degisti;
END $$;
REVOKE ALL ON FUNCTION platform_firma_istisna_taslak_iptal(uuid,uuid,uuid,text) FROM PUBLIC,tekir_app;
GRANT EXECUTE ON FUNCTION platform_firma_istisna_taslak_iptal(uuid,uuid,uuid,text) TO tekir_platform;
COMMIT;
