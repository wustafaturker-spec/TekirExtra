BEGIN;
ALTER TABLE platform_firma_istisna_taslaklari ADD COLUMN onay_at timestamptz,
  ADD COLUMN onaylayan_id uuid REFERENCES platform_kullanicilari(id) ON DELETE RESTRICT;
CREATE FUNCTION platform_firma_ozel_fiyat_onay(p_kullanici uuid,p_tenant uuid,p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE a tenant_abonelikleri; r platform_firma_istisna_taslaklari;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki',0));
  IF NOT EXISTS(SELECT 1 FROM platform_kullanicilari WHERE id=p_kullanici AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN RAISE EXCEPTION 'istisna_yetki'; END IF;
  SELECT * INTO a FROM tenant_abonelikleri WHERE tenant_id=p_tenant FOR UPDATE;
  SELECT * INTO r FROM platform_firma_istisna_taslaklari WHERE id=p_id AND tenant_id=p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'istisna_yok'; END IF;
  IF r.iptal_at IS NOT NULL OR r.bitis<=clock_timestamp() THEN RAISE EXCEPTION 'istisna_tarih'; END IF;
  IF a.paket_surum_id IS DISTINCT FROM r.paket_surum_id OR a.paket_kosullari IS DISTINCT FROM r.kaynak_kosullar OR a.durum NOT IN ('aktif','deneme') THEN RAISE EXCEPTION 'istisna_kaynak_degisti'; END IF;
  IF r.veri ? 'kapsamSozlesmesi' OR NOT(r.veri ? 'fiyatlandirma')
    OR (r.hedef_kosullar-'fiyatlandirma') IS DISTINCT FROM (r.kaynak_kosullar-'fiyatlandirma')
    OR r.hedef_kosullar->'fiyatlandirma' IS DISTINCT FROM r.veri->'fiyatlandirma' THEN RAISE EXCEPTION 'istisna_yalniz_fiyat'; END IF;
  IF EXISTS(SELECT 1 FROM platform_paket_atama_firmalari WHERE tenant_id=p_tenant) THEN RAISE EXCEPTION 'istisna_cakisma'; END IF;
  IF r.onay_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE platform_firma_istisna_taslaklari SET onay_at=clock_timestamp(),onaylayan_id=p_kullanici WHERE id=p_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION platform_firma_ozel_fiyat_onay(uuid,uuid,uuid) FROM PUBLIC,tekir_app;
GRANT EXECUTE ON FUNCTION platform_firma_ozel_fiyat_onay(uuid,uuid,uuid) TO tekir_platform;

CREATE FUNCTION abonelik_etkin_fiyat_kosullari(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE a tenant_abonelikleri; k jsonb;
BEGIN
  IF (session_user='tekir_app' OR current_setting('role')='tekir_app') AND p_tenant IS DISTINCT FROM NULLIF(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'Kiraci baglami gecersiz' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM tenant_abonelikleri WHERE tenant_id=p_tenant;
  SELECT hedef_kosullar INTO k FROM platform_firma_istisna_taslaklari
    WHERE tenant_id=p_tenant AND paket_surum_id=a.paket_surum_id AND kaynak_kosullar=a.paket_kosullari
      AND onay_at IS NOT NULL AND iptal_at IS NULL AND baslangic<=statement_timestamp() AND bitis>statement_timestamp()
    ORDER BY created_at DESC,id DESC LIMIT 1;
  RETURN COALESCE(k,a.paket_kosullari);
END $$;
REVOKE ALL ON FUNCTION abonelik_etkin_fiyat_kosullari(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION abonelik_etkin_fiyat_kosullari(uuid) TO tekir_app,tekir_platform;

CREATE FUNCTION firma_ozel_fiyat_kaynagini_koru() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
BEGIN
  IF ROW(NEW.plan_kodu,NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(OLD.plan_kodu,OLD.paket_surum_id,OLD.paket_kosullari)
    AND EXISTS(SELECT 1 FROM platform_firma_istisna_taslaklari WHERE tenant_id=OLD.tenant_id AND onay_at IS NOT NULL AND iptal_at IS NULL AND bitis>statement_timestamp()) THEN
    RAISE EXCEPTION 'istisna_onayli_fiyat_once_iptal';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER firma_ozel_fiyat_kaynak BEFORE UPDATE ON tenant_abonelikleri FOR EACH ROW EXECUTE FUNCTION firma_ozel_fiyat_kaynagini_koru();

ALTER FUNCTION platform_yaklasan_yenilemeler(integer) RENAME TO platform_yaklasan_yenilemeler_kaynak;
REVOKE ALL ON FUNCTION platform_yaklasan_yenilemeler_kaynak(integer) FROM PUBLIC,tekir_app,tekir_platform;
CREATE FUNCTION platform_yaklasan_yenilemeler(p_gun integer)
RETURNS TABLE(tenant_id uuid,unvan text,plan_kodu text,durum text,donem_sonu timestamp,kart_var boolean,saglayici text,son4 text,kart_markasi text,otomatik_yenileme boolean,kart_ay_sayisi integer,paket_surum_id uuid,paket_kosullari jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
  SELECT r.tenant_id,r.unvan,r.plan_kodu,r.durum,r.donem_sonu,r.kart_var,r.saglayici,r.son4,r.kart_markasi,r.otomatik_yenileme,r.kart_ay_sayisi,r.paket_surum_id,abonelik_etkin_fiyat_kosullari(r.tenant_id)
  FROM platform_yaklasan_yenilemeler_kaynak(p_gun) r
$$;
REVOKE ALL ON FUNCTION platform_yaklasan_yenilemeler(integer) FROM PUBLIC,tekir_app;
GRANT EXECUTE ON FUNCTION platform_yaklasan_yenilemeler(integer) TO tekir_platform;
ALTER FUNCTION platform_tahsilat_adaylari() RENAME TO platform_tahsilat_adaylari_kaynak;
REVOKE ALL ON FUNCTION platform_tahsilat_adaylari_kaynak() FROM PUBLIC,tekir_app,tekir_platform;
CREATE FUNCTION platform_tahsilat_adaylari()
RETURNS TABLE(tenant_id uuid,unvan text,plan_kodu text,durum text,donem_sonu timestamp,fatura_epostasi text,yonetici_epostalari text[],paket_surumu_id uuid,paket_kosullari jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
  SELECT r.tenant_id,r.unvan,r.plan_kodu,r.durum,r.donem_sonu,r.fatura_epostasi,r.yonetici_epostalari,r.paket_surumu_id,abonelik_etkin_fiyat_kosullari(r.tenant_id)
  FROM platform_tahsilat_adaylari_kaynak() r
$$;
REVOKE ALL ON FUNCTION platform_tahsilat_adaylari() FROM PUBLIC,tekir_app;
GRANT EXECUTE ON FUNCTION platform_tahsilat_adaylari() TO tekir_platform;
COMMIT;
