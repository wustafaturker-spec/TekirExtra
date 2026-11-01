-- PLT-38: kart tahsilat hesabı yalnız POS ve etkin abonelik sağlayıcısıyla aynı
-- sağlayıcıda olabilir; platform ekranı ve API'nin bunu denetlemesi için POS
-- hesabının sağlayıcısı da döner (kasa/banka için boş). Dönüş tipi değiştiği için
-- işlev yeniden oluşturulur; eski çağıranlar ek sütunu yok sayar.
DROP FUNCTION platform_tahsilat_hesaplari(uuid);
CREATE FUNCTION platform_tahsilat_hesaplari(p_tenant uuid)
RETURNS TABLE (tur text, id uuid, ad text, doviz text, saglayici text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT 'kasa', k.id, k.ad, k.doviz_cinsi::text, NULL::text FROM kasalar k WHERE k.tenant_id = p_tenant AND k.aktif
  UNION ALL
  SELECT 'banka', b.id, b.ad || ' (' || b.banka_adi || ')', b.doviz_cinsi::text, NULL::text FROM banka_hesaplari b WHERE b.tenant_id = p_tenant AND b.aktif
  UNION ALL
  SELECT 'pos', p.id, p.ad || ' (' || p.saglayici || ')', p.doviz_cinsi::text, p.saglayici::text FROM pos_hesaplari p WHERE p.tenant_id = p_tenant AND p.aktif
  ORDER BY 1, 3;
$$;
REVOKE ALL ON FUNCTION platform_tahsilat_hesaplari(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_tahsilat_hesaplari(uuid) TO tekir_platform;
