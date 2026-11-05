BEGIN;

-- Cross-package assignment still requires a bound source, an active/trial
-- subscription, a complete price period set, and an explicit scope preview.
CREATE OR REPLACE FUNCTION platform_paket_kapsam_onizle(p_kullanici uuid,p_surum uuid,p_tenants uuid[],p_tarih date,p_neden text,p_tur text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE s platform_paket_surumleri; a tenant_abonelikleri; kayit platform_paket_atamalari;
  vade timestamptz; gun date; kod text; tid uuid; unvan text; k jsonb; limitler jsonb; kullanim jsonb; kaynaklar jsonb:='[]';
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
      OR a.paket_kosullari->'fiyatlandirma' IS NULL OR a.paket_kosullari->'fiyatlandirma'='null'::jsonb
      OR a.durum NOT IN ('aktif','deneme') THEN RAISE EXCEPTION 'atama_abonelik_uygun_degil'; END IF;
    IF a.paket_surum_id=s.id THEN RAISE EXCEPTION 'atama_zaten_hedefte'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(a.paket_kosullari->'fiyatlandirma'->'donemler') d
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.fiyatlandirma->'donemler') h WHERE h->'aySayisi'=d->'aySayisi')) THEN RAISE EXCEPTION 'atama_donem_eksik'; END IF;
    SELECT t.unvan INTO unvan FROM tenants t WHERE t.id=tid;
    kullanim:=paket_kota_kullanimi(tid);
    IF EXISTS(SELECT 1 FROM jsonb_each(s.kapsam_sozlesmesi->'kotalar') q WHERE q.value->'sinir'<>'null'::jsonb AND (kullanim->>q.key)::bigint>(q.value->>'sinir')::bigint) THEN RAISE EXCEPTION 'atama_kota_asimi'; END IF;
    k:=a.paket_kosullari||jsonb_build_object('semaSurumu',2,'planKodu',kod,'kapsamSozlesmesi',s.kapsam_sozlesmesi,
      'limitler',limitler,'kaynak','katalog_atamasi','planAdi',s.ad,'fiyatlandirma',s.fiyatlandirma-'gecerlilikTarihi');
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

-- The only cross-plan write path is an approved, same-transaction assignment
-- whose stored source row and target snapshot match exactly.
CREATE OR REPLACE FUNCTION abonelik_paket_bagini_koru() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE sid uuid; k jsonb; auditli boolean;
BEGIN
  IF TG_OP='UPDATE' AND NEW.plan_kodu IS DISTINCT FROM OLD.plan_kodu THEN
    SELECT EXISTS(SELECT 1 FROM platform_paket_atamalari p CROSS JOIN LATERAL jsonb_array_elements(p.veri->'kayitlar') r
      WHERE p.uygulandi_at IS NOT NULL AND p.xmin::text=pg_current_xact_id()::text
        AND p.hedef_surum_id=NEW.paket_surum_id AND r->>'tenantId'=NEW.tenant_id::text
        AND r->'abonelik'=to_jsonb(OLD) AND r->'hedefKosullar'=NEW.paket_kosullari
        AND p.veri->>'hedefPlanKodu'=NEW.plan_kodu
        AND (to_jsonb(NEW)-'plan_kodu'-'paket_surum_id'-'paket_kosullari'-'updated_at')
          =(to_jsonb(OLD)-'plan_kodu'-'paket_surum_id'-'paket_kosullari'-'updated_at')) INTO auditli;
    IF auditli THEN RETURN NEW; END IF;
    IF (CASE WHEN NEW.plan_kodu='v1' THEN 'profesyonel' ELSE NEW.plan_kodu END)
      IS DISTINCT FROM (CASE WHEN OLD.plan_kodu='v1' THEN 'profesyonel' ELSE OLD.plan_kodu END) THEN
      RAISE EXCEPTION 'Kapsamli abonelik plani kontrollu kapsam atamasiyla degistirilmeli; katalog paket kodu yalnız onaylı atamayla değiştirilebilir';
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND (CASE WHEN NEW.plan_kodu='v1' THEN 'profesyonel' ELSE NEW.plan_kodu END)
    IS NOT DISTINCT FROM (CASE WHEN OLD.plan_kodu='v1' THEN 'profesyonel' ELSE OLD.plan_kodu END) THEN
    IF ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(OLD.paket_surum_id,OLD.paket_kosullari) THEN
      IF NOT EXISTS(SELECT 1 FROM platform_paket_atamalari p CROSS JOIN LATERAL jsonb_array_elements(p.veri->'kayitlar') r
        WHERE p.uygulandi_at IS NOT NULL AND p.xmin::text=pg_current_xact_id()::text AND p.hedef_surum_id=NEW.paket_surum_id
          AND ((r->'abonelik')-'kota_surumu')=(to_jsonb(OLD)-'kota_surumu') AND r->'hedefKosullar'=NEW.paket_kosullari
          AND (to_jsonb(NEW)-'paket_surum_id'-'paket_kosullari'-'updated_at')=(to_jsonb(OLD)-'paket_surum_id'-'paket_kosullari'-'updated_at')) THEN
        RAISE EXCEPTION 'Abonelik paket bagi veya korunmus kosullari degistirilemez';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND OLD.paket_kosullari->'semaSurumu'='2'::jsonb THEN RAISE EXCEPTION 'Kapsamli abonelik plani kontrollu kapsam atamasiyla degistirilmeli'; END IF;
  IF TG_OP='INSERT' AND (NEW.paket_surum_id IS NOT NULL OR NEW.paket_kosullari IS NOT NULL) THEN
    SELECT surum_id,kosullar INTO sid,k FROM abonelik_acik_satis_bagi() WHERE surum_id=NEW.paket_surum_id AND plan_kodu=NEW.plan_kodu;
    IF ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(sid,k) THEN RAISE EXCEPTION 'Gecersiz abonelik paket bagi'; END IF;
    RETURN NEW;
  END IF;
  SELECT surum_id,kosullar INTO sid,k FROM abonelik_eski_paket_bagi(NEW.plan_kodu);
  IF TG_OP='INSERT' THEN
    IF (NEW.paket_surum_id IS NOT NULL OR NEW.paket_kosullari IS NOT NULL) AND ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(sid,k) THEN RAISE EXCEPTION 'Gecersiz abonelik paket bagi'; END IF;
  ELSIF ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(OLD.paket_surum_id,OLD.paket_kosullari)
    AND ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(sid,k) THEN RAISE EXCEPTION 'Gecersiz abonelik paket gecisi';
  END IF;
  NEW.paket_surum_id:=sid; NEW.paket_kosullari:=k; RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION platform_paket_atama_hemen_uygula(p_kullanici uuid,p_onizleme uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE p platform_paket_atamalari; s platform_paket_surumleri; a tenant_abonelikleri; r jsonb; hata text;
  bugun date:=(clock_timestamp() AT TIME ZONE 'Europe/Istanbul')::date;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki',0));
  IF NOT EXISTS(SELECT 1 FROM platform_kullanicilari WHERE id=p_kullanici AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN RAISE EXCEPTION 'atama_yetki'; END IF;
  SELECT * INTO p FROM platform_paket_atamalari WHERE id=p_onizleme AND kullanici_id=p_kullanici FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'atama_onizleme_yok'; END IF;
  IF p.uygulandi_at IS NOT NULL THEN RETURN jsonb_build_object('id',p.id,'tekrar',true,'uygulandiAt',p.uygulandi_at,'firmaAdedi',jsonb_array_length(p.veri->'kayitlar')); END IF;
  IF p.son_onay_at<clock_timestamp() OR p.uygulama_tarihi<>bugun THEN RAISE EXCEPTION 'atama_onizleme_suresi_doldu'; END IF;
  SELECT * INTO s FROM platform_paket_surumleri WHERE id=p.hedef_surum_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-paket:'||s.paket_id::text,0));
  SELECT * INTO s FROM platform_paket_surumleri WHERE id=p.hedef_surum_id;
  IF s.durum<>'yayinlandi' OR s.kilit_surumu<>p.hedef_kilit_surumu OR s.fiyatlandirma IS DISTINCT FROM p.veri->'fiyatlandirma' THEN RAISE EXCEPTION 'atama_hedef_degisti'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p.veri->'kayitlar') ORDER BY value->>'tenantId' LOOP
    SELECT * INTO a FROM tenant_abonelikleri WHERE tenant_id=(r->>'tenantId')::uuid FOR UPDATE;
    IF NOT FOUND OR (to_jsonb(a)-'kota_surumu') IS DISTINCT FROM ((r->'abonelik')-'kota_surumu') THEN RAISE EXCEPTION 'atama_kaynak_degisti'; END IF;
  END LOOP;
  IF p.son_onay_at<clock_timestamp() OR p.uygulama_tarihi<>(clock_timestamp() AT TIME ZONE 'Europe/Istanbul')::date THEN RAISE EXCEPTION 'atama_onizleme_suresi_doldu'; END IF;
  IF p.atama_kapsami='kapsam' THEN hata:=platform_paket_plan_denetle(p.id); IF hata IS NOT NULL THEN RAISE EXCEPTION '%',hata; END IF; END IF;
  UPDATE platform_paket_atamalari SET uygulandi_at=clock_timestamp() WHERE id=p.id RETURNING * INTO p;
  FOR r IN SELECT value FROM jsonb_array_elements(p.veri->'kayitlar') ORDER BY value->>'tenantId' LOOP
    UPDATE tenant_abonelikleri SET plan_kodu=CASE WHEN p.atama_kapsami='kapsam' THEN p.veri->>'hedefPlanKodu' ELSE plan_kodu END,paket_surum_id=p.hedef_surum_id,paket_kosullari=r->'hedefKosullar',updated_at=clock_timestamp()
      WHERE tenant_id=(r->>'tenantId')::uuid;
  END LOOP;
  RETURN jsonb_build_object('id',p.id,'tekrar',false,'uygulandiAt',p.uygulandi_at,'firmaAdedi',jsonb_array_length(p.veri->'kayitlar'));
END $$;
REVOKE ALL ON FUNCTION platform_paket_atama_hemen_uygula(uuid,uuid) FROM PUBLIC,tekir_app,tekir_platform;
GRANT EXECUTE ON FUNCTION platform_paket_atama_hemen_uygula(uuid,uuid) TO tekir_platform;

CREATE OR REPLACE FUNCTION platform_paket_plan_isle(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE p platform_paket_atamalari; r jsonb; hata text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki',0));
  SELECT * INTO p FROM platform_paket_atamalari WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR p.planlandi_at IS NULL OR p.uygulandi_at IS NOT NULL OR p.iptal_at IS NOT NULL OR p.engellendi_at IS NOT NULL OR p.uygulanacak_at>clock_timestamp() THEN RETURN jsonb_build_object('id',p_id,'durum','atlandi'); END IF;
  hata:=platform_paket_plan_denetle(p.id,true);
  IF hata IS NOT NULL THEN UPDATE platform_paket_atamalari SET engellendi_at=clock_timestamp(),engel_nedeni=hata WHERE id=p.id; RETURN jsonb_build_object('id',p.id,'durum','inceleme','kullaniciId',p.kullanici_id,'engelNedeni',hata); END IF;
  UPDATE platform_paket_atamalari SET uygulandi_at=clock_timestamp() WHERE id=p.id;
  FOR r IN SELECT value FROM jsonb_array_elements(p.veri->'kayitlar') ORDER BY value->>'tenantId' LOOP
    UPDATE tenant_abonelikleri SET plan_kodu=CASE WHEN p.atama_kapsami='kapsam' THEN p.veri->>'hedefPlanKodu' ELSE plan_kodu END,paket_surum_id=p.hedef_surum_id,paket_kosullari=r->'hedefKosullar',updated_at=clock_timestamp()
      WHERE tenant_id=(r->>'tenantId')::uuid;
  END LOOP;
  DELETE FROM platform_paket_atama_firmalari WHERE atama_id=p.id;
  RETURN jsonb_build_object('id',p.id,'durum','uygulandi','kullaniciId',p.kullanici_id);
END $$;
REVOKE ALL ON FUNCTION platform_paket_plan_isle(uuid) FROM PUBLIC,tekir_app;
GRANT EXECUTE ON FUNCTION platform_paket_plan_isle(uuid) TO tekir_platform;

-- Payment reminders need the bound snapshot to recognize priceable catalog
-- plans whose codes are absent from the legacy hard-coded plan list.
DROP FUNCTION platform_tahsilat_adaylari();
CREATE FUNCTION platform_tahsilat_adaylari()
RETURNS TABLE (tenant_id uuid,unvan text,plan_kodu text,durum text,donem_sonu timestamp,
  fatura_epostasi text,yonetici_epostalari text[],paket_surumu_id uuid,paket_kosullari jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public SET row_security=off AS $$
  SELECT t.id,t.unvan,a.plan_kodu,a.durum::text,a.donem_sonu,a.fatura_epostasi,
    COALESCE((SELECT array_agg(u.eposta ORDER BY u.eposta) FROM users u WHERE u.tenant_id=t.id AND u.aktif AND u.rol='yonetici'),ARRAY[]::text[]),
    a.paket_surum_id,a.paket_kosullari
  FROM tenant_abonelikleri a JOIN tenants t ON t.id=a.tenant_id
  WHERE a.donem_sonu IS NOT NULL AND a.durum IN ('aktif','deneme')
$$;
REVOKE ALL ON FUNCTION platform_tahsilat_adaylari() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_tahsilat_adaylari() TO tekir_platform;
COMMIT;
