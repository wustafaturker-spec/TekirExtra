BEGIN;
CREATE FUNCTION platform_firma_istisna_uygunluk(p_kullanici uuid,p_tenant uuid,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE a tenant_abonelikleri; r platform_firma_istisna_taslaklari; kullanim jsonb;
  engeller jsonb:='[]'; q record; simdi timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki',0));
  IF NOT EXISTS(SELECT 1 FROM platform_kullanicilari WHERE id=p_kullanici AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN RAISE EXCEPTION 'istisna_yetki'; END IF;
  SELECT * INTO a FROM tenant_abonelikleri WHERE tenant_id=p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'istisna_kaynak_degisti'; END IF;
  SELECT * INTO r FROM platform_firma_istisna_taslaklari WHERE id=p_id AND tenant_id=p_tenant FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'istisna_yok'; END IF;
  simdi:=clock_timestamp();
  IF r.iptal_at IS NOT NULL THEN engeller:=engeller||'"iptal_edildi"'::jsonb; END IF;
  IF r.bitis<=simdi THEN engeller:=engeller||'"suresi_doldu"'::jsonb; END IF;
  IF a.paket_surum_id IS DISTINCT FROM r.paket_surum_id OR a.paket_kosullari IS DISTINCT FROM r.kaynak_kosullar THEN engeller:=engeller||'"kaynak_degisti"'::jsonb; END IF;
  IF a.durum NOT IN ('aktif','deneme') THEN engeller:=engeller||'"abonelik_uygun_degil"'::jsonb; END IF;
  IF EXISTS(SELECT 1 FROM platform_paket_atama_firmalari WHERE tenant_id=p_tenant) THEN engeller:=engeller||'"bekleyen_paket_atamasi"'::jsonb; END IF;
  kullanim:=paket_kota_kullanimi(p_tenant);
  FOR q IN SELECT key,value FROM jsonb_each(r.hedef_kosullar->'limitler') LOOP
    IF q.value<>'null'::jsonb AND (kullanim->>q.key)::bigint>(q.value#>>'{}')::bigint THEN
      engeller:=engeller||to_jsonb('kota_asimi:'||q.key);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('id',p_id,'tenantId',p_tenant,'kontrolAt',simdi,'kosullarUygun',jsonb_array_length(engeller)=0,
    'engeller',engeller,'kullanim',kullanim,'hedefLimitler',r.hedef_kosullar->'limitler',
    'standartLimitler',r.kaynak_kosullar->'limitler','baslangic',r.baslangic,'bitis',r.bitis,'uygulamaEntegrasyonu',false);
END $$;
REVOKE ALL ON FUNCTION platform_firma_istisna_uygunluk(uuid,uuid,uuid) FROM PUBLIC,tekir_app;
GRANT EXECUTE ON FUNCTION platform_firma_istisna_uygunluk(uuid,uuid,uuid) TO tekir_platform;
COMMIT;
