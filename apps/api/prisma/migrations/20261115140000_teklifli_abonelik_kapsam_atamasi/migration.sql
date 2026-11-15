-- PLT-126 (kullanıcı onayı 2026-11-15): eski plan geçişinden gelen ve kayıtlı fiyatı olmayan
-- (teklifli, ör. kurumsal) abonelik aynı paketin yayınlanmış sürümüne kapsam atamasıyla geçebilir.
-- Kapsam (modül, kota, depolama, plan özellikleri) ve sürüm bağı değişir; fiyat koşulu null kalır.
-- Fiyatlı aboneliklerde davranış değişmez. Uygulama işlevleri fiyat denetlemediği için yalnız önizleme değişir.
BEGIN;
CREATE OR REPLACE FUNCTION platform_paket_kapsam_onizle(p_kullanici uuid,p_surum uuid,p_tenants uuid[],p_tarih date,p_neden text,p_tur text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE s platform_paket_surumleri; a tenant_abonelikleri; kayit platform_paket_atamalari;
  vade timestamptz; gun date; kod text; teklifli boolean; tid uuid; unvan text; k jsonb; limitler jsonb; kullanim jsonb; kaynaklar jsonb:='[]';
  bugun date:=(clock_timestamp() AT TIME ZONE 'Europe/Istanbul')::date;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki',0));
  IF NOT EXISTS(SELECT 1 FROM platform_kullanicilari WHERE id=p_kullanici AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN RAISE EXCEPTION 'atama_yetki'; END IF;
  IF p_tur='bugun' THEN
    IF p_tarih IS DISTINCT FROM bugun THEN RAISE EXCEPTION 'atama_yalniz_bugun'; END IF; vade:=clock_timestamp();
  ELSIF p_tur='tarih' THEN
    IF p_tarih IS NULL OR p_tarih<=bugun OR p_tarih>bugun+366 THEN RAISE EXCEPTION 'atama_plan_tarih'; END IF;
    vade:=p_tarih::timestamp AT TIME ZONE 'Europe/Istanbul';
  ELSIF p_tur='donem_sonu' THEN
    IF cardinality(p_tenants) IS DISTINCT FROM 1 OR p_tarih IS NOT NULL THEN RAISE EXCEPTION 'atama_plan_tek_firma'; END IF;
    SELECT donem_sonu AT TIME ZONE 'UTC' INTO vade FROM tenant_abonelikleri WHERE tenant_id=p_tenants[1];
    IF vade IS NULL OR vade<=clock_timestamp() OR vade>clock_timestamp()+interval '366 days' THEN RAISE EXCEPTION 'atama_plan_donem'; END IF;
  ELSE RAISE EXCEPTION 'atama_plan_tur'; END IF;
  gun:=(vade AT TIME ZONE 'Europe/Istanbul')::date;
  IF p_neden IS NULL OR length(btrim(p_neden)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'atama_neden'; END IF;
  IF p_tenants IS NULL OR cardinality(p_tenants) NOT BETWEEN 1 AND 25 OR array_ndims(p_tenants)<>1
    OR EXISTS(SELECT 1 FROM unnest(p_tenants) t WHERE t IS NULL)
    OR (SELECT count(DISTINCT t) FROM unnest(p_tenants) t)<>cardinality(p_tenants) THEN RAISE EXCEPTION 'atama_firma_secimi'; END IF;
  SELECT * INTO s FROM platform_paket_surumleri WHERE id=p_surum;
  IF NOT FOUND THEN RAISE EXCEPTION 'atama_surum_yok'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-paket:'||s.paket_id::text,0));
  SELECT * INTO s FROM platform_paket_surumleri WHERE id=p_surum;
  SELECT p.kod INTO kod FROM platform_paketler p WHERE p.id=s.paket_id;
  IF s.durum<>'yayinlandi' OR s.fiyatlandirma IS NULL OR kod IS NULL THEN RAISE EXCEPTION 'atama_hedef_uygun_degil'; END IF;
  IF s.kapsam_sozlesmesi IS NULL THEN RAISE EXCEPTION 'atama_kapsam_eksik'; END IF;
  SELECT jsonb_object_agg(key,value->'sinir') INTO limitler FROM jsonb_each(s.kapsam_sozlesmesi->'kotalar');
  IF (s.fiyatlandirma->>'gecerlilikTarihi')::date>gun THEN RAISE EXCEPTION 'atama_fiyat_henuz_gecerli_degil'; END IF;
  FOR tid IN SELECT t FROM unnest(p_tenants) t ORDER BY t LOOP
    SELECT * INTO a FROM tenant_abonelikleri WHERE tenant_id=tid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'atama_abonelik_yok'; END IF;
    IF p_tur='donem_sonu' AND (a.donem_sonu AT TIME ZONE 'UTC') IS DISTINCT FROM vade THEN RAISE EXCEPTION 'atama_kaynak_degisti'; END IF;
    IF a.paket_surum_id IS NULL OR a.paket_kosullari IS NULL
      OR a.durum NOT IN ('aktif','deneme') THEN RAISE EXCEPTION 'atama_abonelik_uygun_degil'; END IF;
    -- PLT-126: kayıtlı fiyatı olmayan (teklifli) abonelik yalnız aynı paketin sürümüne kapsamla geçer; fiyat koşulu "teklifle" kalır.
    teklifli:=a.paket_kosullari->'fiyatlandirma' IS NULL OR a.paket_kosullari->'fiyatlandirma'='null'::jsonb;
    IF teklifli AND (CASE WHEN a.plan_kodu='v1' THEN 'profesyonel' ELSE a.plan_kodu END)<>kod THEN RAISE EXCEPTION 'atama_teklifli_ayni_paket'; END IF;
    IF a.paket_surum_id=s.id THEN RAISE EXCEPTION 'atama_zaten_hedefte'; END IF;
    IF NOT teklifli AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.paket_kosullari->'fiyatlandirma'->'donemler') d
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.fiyatlandirma->'donemler') h WHERE h->'aySayisi'=d->'aySayisi')) THEN RAISE EXCEPTION 'atama_donem_eksik'; END IF;
    SELECT t.unvan INTO unvan FROM tenants t WHERE t.id=tid;
    kullanim:=paket_kota_kullanimi(tid);
    IF EXISTS(SELECT 1 FROM jsonb_each(s.kapsam_sozlesmesi->'kotalar') q WHERE q.value->'sinir'<>'null'::jsonb AND (kullanim->>q.key)::bigint>(q.value->>'sinir')::bigint) THEN RAISE EXCEPTION 'atama_kota_asimi'; END IF;
    k:=a.paket_kosullari||jsonb_build_object('semaSurumu',2,'planKodu',kod,'kapsamSozlesmesi',s.kapsam_sozlesmesi,
      'limitler',limitler,'kaynak','katalog_atamasi','planAdi',s.ad,'fiyatlandirma',CASE WHEN teklifli THEN 'null'::jsonb ELSE s.fiyatlandirma-'gecerlilikTarihi' END);
    kaynaklar:=kaynaklar||jsonb_build_array(jsonb_build_object('tenantId',tid,'unvan',unvan,'abonelik',to_jsonb(a),'hedefKosullar',k,'kullanim',kullanim));
  END LOOP;
  INSERT INTO platform_paket_atamalari(kullanici_id,hedef_surum_id,hedef_kilit_surumu,uygulama_tarihi,neden,veri,uygulama_turu,uygulanacak_at,atama_kapsami)
    VALUES(p_kullanici,p_surum,s.kilit_surumu,gun,btrim(p_neden),jsonb_build_object('hedefPlanKodu',kod,'hedefPaketAdi',s.ad,'hedefSurumNo',s.surum_no,
      'hedefKapsam',s.kapsam_sozlesmesi,'fiyatlandirma',s.fiyatlandirma,'kayitlar',kaynaklar),p_tur,vade,'kapsam') RETURNING * INTO kayit;
  RETURN jsonb_build_object('atamaKapsami','kapsam','uygulamaTuru',kayit.uygulama_turu,'uygulanacakAt',kayit.uygulanacak_at,'id',kayit.id,
    'uygulamaTarihi',kayit.uygulama_tarihi,'sonOnayAt',kayit.son_onay_at,'neden',kayit.neden,'hedefSurumId',s.id,'veri',kayit.veri);
END $$;
REVOKE ALL ON FUNCTION platform_paket_kapsam_onizle(uuid,uuid,uuid[],date,text,text) FROM PUBLIC,tekir_app;
GRANT EXECUTE ON FUNCTION platform_paket_kapsam_onizle(uuid,uuid,uuid[],date,text,text) TO tekir_platform;
COMMIT;
