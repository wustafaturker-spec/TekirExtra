BEGIN;
CREATE OR REPLACE FUNCTION platform_paket_kapsamini_koru() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE k jsonb := NEW.kapsam_sozlesmesi; q jsonb; kod text; modul jsonb;
  kodlar text[] := ARRAY['satis','fatura','ebelge','cari','kasa_banka','masraf_gelir','satin_alma','stok','uretim','personel','demirbas_arac','projeler','butce_nakit','raporlar','mali_musavir','donem_kapatma','yapay_zeka'];
BEGIN
  IF TG_OP='UPDATE' AND OLD.durum<>'taslak' AND NEW.kapsam_sozlesmesi IS DISTINCT FROM OLD.kapsam_sozlesmesi THEN
    RAISE EXCEPTION 'Yayinlanmis paket kapsami degistirilemez';
  END IF;
  IF k IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(k) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Gecersiz paket kapsam sozlesmesi'; END IF;
  IF NOT (k ?& ARRAY['semaSurumu','moduller','kotalar']) OR (SELECT count(*) FROM jsonb_object_keys(k-'depolama'))<>3
    OR k->'semaSurumu' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(k->'moduller') IS DISTINCT FROM 'array'
    OR jsonb_typeof(k->'kotalar') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Gecersiz paket kapsam sozlesmesi'; END IF;
  IF jsonb_array_length(k->'moduller') NOT BETWEEN 1 AND cardinality(kodlar)
    OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(k->'moduller'))<>jsonb_array_length(k->'moduller') THEN
    RAISE EXCEPTION 'Gecersiz veya tekrarli paket modulleri';
  END IF;
  FOR modul IN SELECT value FROM jsonb_array_elements(k->'moduller') LOOP
    IF jsonb_typeof(modul) IS DISTINCT FROM 'string' OR NOT ((modul#>>'{}')=ANY(kodlar)) THEN RAISE EXCEPTION 'Gecersiz paket modulu'; END IF;
  END LOOP;
  IF (k->'moduller' ? 'fatura' AND NOT (k->'moduller' ? 'cari'))
    OR (k->'moduller' ? 'ebelge' AND NOT (k->'moduller' ? 'fatura'))
    OR (k->'moduller' ? 'uretim' AND NOT (k->'moduller' ? 'stok')) THEN RAISE EXCEPTION 'Paket modul bagimliligi eksik'; END IF;
  IF NOT (k->'kotalar' ?& ARRAY['kullanici','cari','stok','aylikFatura']) OR (SELECT count(*) FROM jsonb_object_keys(k->'kotalar'))<>4 THEN RAISE EXCEPTION 'Gecersiz paket kotalari'; END IF;
  FOREACH kod IN ARRAY ARRAY['kullanici','cari','stok','aylikFatura'] LOOP
    q := k->'kotalar'->kod;
    IF jsonb_typeof(q) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Gecersiz paket kotasi'; END IF;
    IF NOT (q ?& ARRAY['sinir','uyariYuzdesi']) OR (SELECT count(*) FROM jsonb_object_keys(q))<>2
      OR jsonb_typeof(q->'uyariYuzdesi') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Gecersiz kota esigi'; END IF;
    IF (q->>'uyariYuzdesi')::numeric NOT BETWEEN 1 AND 99 OR trunc((q->>'uyariYuzdesi')::numeric)<>(q->>'uyariYuzdesi')::numeric THEN RAISE EXCEPTION 'Gecersiz kota esigi'; END IF;
    IF q->'sinir'<>'null'::jsonb THEN
      IF jsonb_typeof(q->'sinir') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Gecersiz kota siniri'; END IF;
      IF (q->>'sinir')::numeric NOT BETWEEN 0 AND 2147483647 OR trunc((q->>'sinir')::numeric)<>(q->>'sinir')::numeric THEN RAISE EXCEPTION 'Gecersiz kota siniri'; END IF;
    END IF;
  END LOOP;
  IF k ? 'depolama' THEN
    q:=k->'depolama';
    IF jsonb_typeof(q) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Gecersiz depolama sozlesmesi'; END IF;
    IF NOT(q ?& ARRAY['sinirBayt','uyariYuzdesi']) OR (SELECT count(*) FROM jsonb_object_keys(q))<>2
      OR jsonb_typeof(q->'uyariYuzdesi') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Gecersiz depolama sozlesmesi'; END IF;
    IF (q->>'uyariYuzdesi')::numeric NOT BETWEEN 1 AND 99 OR trunc((q->>'uyariYuzdesi')::numeric)<>(q->>'uyariYuzdesi')::numeric THEN RAISE EXCEPTION 'Gecersiz depolama esigi'; END IF;
    IF q->'sinirBayt'<>'null'::jsonb THEN
      IF jsonb_typeof(q->'sinirBayt') IS DISTINCT FROM 'string' OR (q->>'sinirBayt') !~ '^(0|[1-9][0-9]{0,18})$' THEN RAISE EXCEPTION 'Gecersiz depolama siniri'; END IF;
      IF (q->>'sinirBayt')::numeric>9223372036854775807 THEN RAISE EXCEPTION 'Gecersiz depolama siniri'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION ek_depolama_siniri(p_tenant uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
  SELECT (abonelik_etkin_fiyat_kosullari(p_tenant)->'kapsamSozlesmesi'->'depolama'->>'sinirBayt')::bigint
$$;
CREATE FUNCTION ek_hacmi_kilitle(p_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
BEGIN
  UPDATE tenant_abonelikleri SET kota_surumu=gen_random_uuid() WHERE tenant_id=p_tenant;
  PERFORM pg_advisory_xact_lock(hashtextextended('ek-hacmi:'||p_tenant::text,0));
END $$;
REVOKE ALL ON FUNCTION ek_depolama_siniri(uuid),ek_hacmi_kilitle(uuid) FROM PUBLIC,tekir_app,tekir_platform;

CREATE FUNCTION ek_depolama_kotasini_koru() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE tid uuid; sinir bigint; toplam numeric; eski_bayt bigint:=0;
BEGIN
  IF TG_OP='DELETE' THEN tid:=OLD.tenant_id; ELSE tid:=NEW.tenant_id; END IF;
  IF (session_user='tekir_app' OR current_setting('role')='tekir_app') AND tid IS DISTINCT FROM NULLIF(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'Kiraci baglami gecersiz' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'Ek kiracisi degistirilemez'; END IF;
  PERFORM ek_hacmi_kilitle(tid);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.boyut<0 THEN RAISE EXCEPTION 'Gecersiz ek boyutu'; END IF;
  IF TG_OP='UPDATE' THEN
    eski_bayt:=GREATEST(OLD.boyut,0);
    IF NEW.boyut<=eski_bayt THEN RETURN NEW; END IF;
  END IF;
  sinir:=ek_depolama_siniri(tid);
  IF sinir IS NOT NULL THEN
    SELECT COALESCE(sum(GREATEST(boyut,0)::bigint),0) INTO toplam FROM ekler WHERE tenant_id=tid;
    toplam:=toplam-eski_bayt+NEW.boyut;
    SELECT toplam+COALESCE(sum(bayt),0) INTO toplam FROM ek_yukleme_rezervasyonlari
      WHERE tenant_id=tid AND durum='ayrildi' AND son_gecerlilik>clock_timestamp() AND depo_anahtari<>NEW.depo_anahtari;
    IF toplam>sinir THEN RAISE EXCEPTION 'ek_depolama_kota_dolu'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ek_depolama_kotasi BEFORE INSERT OR UPDATE OR DELETE ON ekler FOR EACH ROW EXECUTE FUNCTION ek_depolama_kotasini_koru();
CREATE OR REPLACE FUNCTION ek_yukleme_ayir(p_id uuid,p_bayt bigint,p_anahtar text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE tid uuid:=NULLIF(current_setting('app.tenant_id',true),'')::uuid; r ek_yukleme_rezervasyonlari; sinir bigint; toplam numeric;
BEGIN
  IF tid IS NULL OR p_id IS NULL OR p_bayt IS NULL OR p_bayt NOT BETWEEN 1 AND 10485760 OR p_anahtar IS NULL OR strpos(p_anahtar,tid::text||'/')<>1 THEN RAISE EXCEPTION 'ek_rezervasyon_girdi'; END IF;
  PERFORM ek_hacmi_kilitle(tid);
  SELECT * INTO r FROM ek_yukleme_rezervasyonlari WHERE id=p_id FOR UPDATE;
  IF FOUND THEN
    IF r.tenant_id<>tid OR r.bayt<>p_bayt OR r.depo_anahtari<>p_anahtar OR r.durum<>'ayrildi' OR r.son_gecerlilik<=clock_timestamp() THEN RAISE EXCEPTION 'ek_rezervasyon_cakisma'; END IF;
    RETURN r.id;
  END IF;
  sinir:=ek_depolama_siniri(tid);
  IF sinir IS NOT NULL THEN
    SELECT COALESCE(sum(GREATEST(boyut,0)::bigint),0) INTO toplam FROM ekler WHERE tenant_id=tid;
    SELECT toplam+COALESCE(sum(bayt),0)+p_bayt INTO toplam FROM ek_yukleme_rezervasyonlari
      WHERE tenant_id=tid AND durum='ayrildi' AND son_gecerlilik>clock_timestamp();
    IF toplam>sinir THEN RAISE EXCEPTION 'ek_depolama_kota_dolu'; END IF;
  END IF;
  INSERT INTO ek_yukleme_rezervasyonlari(id,tenant_id,depo_anahtari,bayt) VALUES(p_id,tid,p_anahtar,p_bayt);
  RETURN p_id;
END $$;
CREATE OR REPLACE FUNCTION ek_yukleme_kapat(p_id uuid,p_tamam boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE tid uuid:=NULLIF(current_setting('app.tenant_id',true),'')::uuid; r ek_yukleme_rezervasyonlari; sinir bigint; toplam numeric;
BEGIN
  IF tid IS NULL OR p_tamam IS NULL THEN RAISE EXCEPTION 'ek_rezervasyon_girdi'; END IF;
  PERFORM ek_hacmi_kilitle(tid);
  SELECT * INTO r FROM ek_yukleme_rezervasyonlari WHERE id=p_id AND tenant_id=tid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ek_rezervasyon_yok'; END IF;
  IF r.durum<>'ayrildi' THEN
    IF r.durum=(CASE WHEN p_tamam THEN 'tamamlandi' ELSE 'iptal' END) THEN RETURN false; END IF;
    RAISE EXCEPTION 'ek_rezervasyon_kapali';
  END IF;
  IF p_tamam THEN
    IF r.son_gecerlilik<=clock_timestamp() THEN RAISE EXCEPTION 'ek_rezervasyon_suresi_doldu'; END IF;
    IF NOT EXISTS(SELECT 1 FROM ekler WHERE tenant_id=tid AND depo_anahtari=r.depo_anahtari AND boyut=r.bayt) THEN RAISE EXCEPTION 'ek_rezervasyon_dosya_yok'; END IF;
  END IF;
  UPDATE ek_yukleme_rezervasyonlari SET durum=CASE WHEN p_tamam THEN 'tamamlandi' ELSE 'iptal' END,kapandi_at=clock_timestamp() WHERE id=p_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION platform_firma_istisna_onay_ic(p_kullanici uuid,p_tenant uuid,p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE a tenant_abonelikleri; r platform_firma_istisna_taslaklari; beklenen jsonb; limitler jsonb; kullanim jsonb; depolama_sinir bigint; depolama_toplam numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki',0));
  IF NOT EXISTS(SELECT 1 FROM platform_kullanicilari WHERE id=p_kullanici AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN RAISE EXCEPTION 'istisna_yetki'; END IF;
  SELECT * INTO a FROM tenant_abonelikleri WHERE tenant_id=p_tenant FOR UPDATE;
  SELECT * INTO r FROM platform_firma_istisna_taslaklari WHERE id=p_id AND tenant_id=p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'istisna_yok'; END IF;
  IF r.iptal_at IS NOT NULL OR r.bitis<=clock_timestamp() THEN RAISE EXCEPTION 'istisna_tarih'; END IF;
  IF a.paket_surum_id IS DISTINCT FROM r.paket_surum_id OR a.paket_kosullari IS DISTINCT FROM r.kaynak_kosullar OR a.durum NOT IN ('aktif','deneme') THEN RAISE EXCEPTION 'istisna_kaynak_degisti'; END IF;
  beklenen:=r.kaynak_kosullar;
  IF r.veri ? 'fiyatlandirma' THEN beklenen:=beklenen||jsonb_build_object('fiyatlandirma',r.veri->'fiyatlandirma'); END IF;
  IF r.veri ? 'kapsamSozlesmesi' THEN
    SELECT jsonb_object_agg(key,value->'sinir') INTO limitler FROM jsonb_each(r.veri->'kapsamSozlesmesi'->'kotalar');
    beklenen:=beklenen||jsonb_build_object('semaSurumu',2,'kaynak','katalog_atamasi','kapsamSozlesmesi',r.veri->'kapsamSozlesmesi','limitler',limitler);
    depolama_sinir:=(r.hedef_kosullar->'kapsamSozlesmesi'->'depolama'->>'sinirBayt')::bigint;
    IF depolama_sinir IS NOT NULL THEN
      SELECT COALESCE(sum(GREATEST(boyut,0)::bigint),0) INTO depolama_toplam FROM ekler WHERE tenant_id=p_tenant;
      SELECT depolama_toplam+COALESCE(sum(bayt),0) INTO depolama_toplam FROM ek_yukleme_rezervasyonlari WHERE tenant_id=p_tenant AND durum='ayrildi' AND son_gecerlilik>clock_timestamp();
      IF depolama_toplam>depolama_sinir THEN RAISE EXCEPTION 'istisna_depolama_asimi'; END IF;
    END IF;
    kullanim:=paket_kota_kullanimi(p_tenant);
    IF EXISTS(SELECT 1 FROM jsonb_each(limitler) q WHERE q.value<>'null'::jsonb AND (kullanim->>q.key)::bigint>(q.value#>>'{}')::bigint) THEN RAISE EXCEPTION 'istisna_kota_asimi'; END IF;
  END IF;
  IF NOT(r.veri ? 'fiyatlandirma' OR r.veri ? 'kapsamSozlesmesi') OR beklenen IS DISTINCT FROM r.hedef_kosullar THEN RAISE EXCEPTION 'istisna_hedef_gecersiz'; END IF;
  IF EXISTS(SELECT 1 FROM platform_paket_atama_firmalari WHERE tenant_id=p_tenant) THEN RAISE EXCEPTION 'istisna_cakisma'; END IF;
  IF r.onay_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE platform_firma_istisna_taslaklari SET onay_at=clock_timestamp(),onaylayan_id=p_kullanici WHERE id=p_id;
  RETURN true;
END $$;


ALTER FUNCTION platform_paket_plan_denetle(uuid,boolean) RENAME TO platform_paket_plan_denetle_kaynak;
REVOKE ALL ON FUNCTION platform_paket_plan_denetle_kaynak(uuid,boolean) FROM PUBLIC,tekir_app,tekir_platform;
CREATE FUNCTION platform_paket_plan_denetle(p_id uuid,p_zamani_geldi boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE hata text; p platform_paket_atamalari; r jsonb; sinir bigint; toplam numeric; tid uuid;
BEGIN
  hata:=platform_paket_plan_denetle_kaynak(p_id,p_zamani_geldi);
  IF hata IS NOT NULL THEN RETURN hata; END IF;
  SELECT * INTO p FROM platform_paket_atamalari WHERE id=p_id;
  IF p.atama_kapsami='kapsam' THEN
    sinir:=(p.veri->'hedefKapsam'->'depolama'->>'sinirBayt')::bigint;
    IF sinir IS NOT NULL THEN
      FOR r IN SELECT value FROM jsonb_array_elements(p.veri->'kayitlar') LOOP
        tid:=(r->>'tenantId')::uuid;
        SELECT COALESCE(sum(GREATEST(boyut,0)::bigint),0) INTO toplam FROM ekler WHERE tenant_id=tid;
        SELECT toplam+COALESCE(sum(bayt),0) INTO toplam FROM ek_yukleme_rezervasyonlari WHERE tenant_id=tid AND durum='ayrildi' AND son_gecerlilik>clock_timestamp();
        IF toplam>sinir THEN RETURN 'atama_depolama_asimi'; END IF;
      END LOOP;
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION platform_paket_plan_denetle(uuid,boolean) FROM PUBLIC,tekir_app,tekir_platform;

ALTER FUNCTION platform_firma_ek_hacmi(uuid,uuid) RENAME TO platform_firma_ek_hacmi_kaynak;
REVOKE ALL ON FUNCTION platform_firma_ek_hacmi_kaynak(uuid,uuid) FROM PUBLIC,tekir_app,tekir_platform;
CREATE FUNCTION platform_firma_ek_hacmi(p_kullanici uuid,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE r jsonb; sinir bigint; esik integer; kullanim numeric; durum text;
BEGIN
  r:=platform_firma_ek_hacmi_kaynak(p_kullanici,p_tenant);
  sinir:=ek_depolama_siniri(p_tenant);
  esik:=COALESCE((abonelik_etkin_fiyat_kosullari(p_tenant)->'kapsamSozlesmesi'->'depolama'->>'uyariYuzdesi')::integer,80);
  kullanim:=(r->>'bayt')::numeric+(r->>'bekleyenBayt')::numeric;
  durum:=CASE WHEN sinir IS NULL THEN 'sinirsiz' WHEN kullanim>sinir THEN 'asim' WHEN kullanim=sinir THEN 'dolu' WHEN kullanim*100>=sinir::numeric*esik THEN 'uyari' ELSE 'normal' END;
  RETURN r||jsonb_build_object('sinirBayt',sinir::text,'uyariYuzdesi',esik,'kotaUygulaniyor',sinir IS NOT NULL,'durum',durum);
END $$;
REVOKE ALL ON FUNCTION platform_firma_ek_hacmi(uuid,uuid) FROM PUBLIC,tekir_app;
GRANT EXECUTE ON FUNCTION platform_firma_ek_hacmi(uuid,uuid) TO tekir_platform;

ALTER FUNCTION platform_firma_istisna_uygunluk(uuid,uuid,uuid) RENAME TO platform_firma_istisna_uygunluk_kaynak;
REVOKE ALL ON FUNCTION platform_firma_istisna_uygunluk_kaynak(uuid,uuid,uuid) FROM PUBLIC,tekir_app,tekir_platform;
CREATE FUNCTION platform_firma_istisna_uygunluk(p_kullanici uuid,p_tenant uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE sonuc jsonb; r platform_firma_istisna_taslaklari; bayt numeric; bekleyen numeric; sinir bigint; standart bigint;
BEGIN
  sonuc:=platform_firma_istisna_uygunluk_kaynak(p_kullanici,p_tenant,p_id);
  SELECT * INTO r FROM platform_firma_istisna_taslaklari WHERE id=p_id AND tenant_id=p_tenant;
  sinir:=(r.hedef_kosullar->'kapsamSozlesmesi'->'depolama'->>'sinirBayt')::bigint;
  standart:=(r.kaynak_kosullar->'kapsamSozlesmesi'->'depolama'->>'sinirBayt')::bigint;
  SELECT COALESCE(sum(GREATEST(boyut,0)::bigint),0) INTO bayt FROM ekler WHERE tenant_id=p_tenant;
  SELECT COALESCE(sum(e.bayt),0) INTO bekleyen FROM ek_yukleme_rezervasyonlari e WHERE e.tenant_id=p_tenant AND durum='ayrildi' AND son_gecerlilik>clock_timestamp();
  IF sinir IS NOT NULL AND bayt+bekleyen>sinir THEN
    sonuc:=sonuc||jsonb_build_object('kosullarUygun',false,'engeller',(sonuc->'engeller')||'"depolama_asimi"'::jsonb);
  END IF;
  RETURN sonuc||jsonb_build_object('depolama',jsonb_build_object('kayitliBayt',bayt::text,'bekleyenBayt',bekleyen::text,'hedefSinirBayt',sinir::text,'standartSinirBayt',standart::text));
END $$;
REVOKE ALL ON FUNCTION platform_firma_istisna_uygunluk(uuid,uuid,uuid) FROM PUBLIC,tekir_app;
GRANT EXECUTE ON FUNCTION platform_firma_istisna_uygunluk(uuid,uuid,uuid) TO tekir_platform;
COMMIT;
