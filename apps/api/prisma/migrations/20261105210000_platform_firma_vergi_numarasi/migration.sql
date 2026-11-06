CREATE FUNCTION platform_firma_vkn_degistir(p_tenant_id uuid, p_yeni_vkn text)
RETURNS TABLE(eski_vkn text, yeni_vkn text, kisi_turu text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE
  v_eski text;
  v_tur text;
BEGIN
  SELECT t.vkn, t.kisi_turu INTO v_eski, v_tur
  FROM tenants t WHERE t.id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF length(p_yeni_vkn) <> (CASE WHEN v_tur = 'gercek' THEN 11 ELSE 10 END)
     OR p_yeni_vkn !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'gecersiz_vergi_numarasi';
  END IF;
  PERFORM set_config('app.platform_vkn_change', p_tenant_id::text, true);
  UPDATE tenants SET vkn = p_yeni_vkn WHERE id = p_tenant_id;
  RETURN QUERY SELECT v_eski, p_yeni_vkn, v_tur;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'vergi_numarasi_cakisma';
END;
$$;

REVOKE ALL ON FUNCTION platform_firma_vkn_degistir(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_firma_vkn_degistir(uuid, text) TO tekir_platform;
