BEGIN;
ALTER TABLE tenant_abonelikleri ADD COLUMN kota_surumu uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE platform_paket_atamalari ADD COLUMN atama_kapsami text NOT NULL DEFAULT 'fiyat' CHECK (atama_kapsami IN ('fiyat','kapsam'));

-- Eşzamanlı kaynak yazımlarında ve kapsam onayında ortak kilit bu abonelik satırıdır.
CREATE FUNCTION paket_kota_kullanimi(p_tenant uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
  SELECT jsonb_build_object(
    'kullanici',(SELECT count(*) FROM users WHERE tenant_id=p_tenant AND aktif AND rol<>'calisan'),
    'cari',(SELECT count(*) FROM cari_hesaplar WHERE tenant_id=p_tenant AND aktif),
    'stok',(SELECT count(*) FROM stok_kartlari WHERE tenant_id=p_tenant AND aktif),
    'aylikFatura',(SELECT count(*) FROM faturalar WHERE tenant_id=p_tenant
      AND created_at >= (date_trunc('month',clock_timestamp() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'UTC'
      AND created_at < ((date_trunc('month',clock_timestamp() AT TIME ZONE 'Europe/Istanbul')+interval '1 month') AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'UTC'));
$$;
REVOKE ALL ON FUNCTION paket_kota_kullanimi(uuid) FROM PUBLIC,tekir_app,tekir_platform;

CREATE FUNCTION paket_kotasini_koru() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE n jsonb; o jsonb; yeni uuid; eski uuid; tid uuid; etkin_yeni boolean; etkin_eski boolean;
  yeni_ay timestamp; eski_ay timestamp; k jsonb; kapsam jsonb; sinir bigint; adet bigint; kod text := TG_ARGV[0]; modul text := TG_ARGV[1];
BEGIN
  IF TG_OP<>'DELETE' THEN n:=to_jsonb(NEW); yeni:=(n->>'tenant_id')::uuid; END IF;
  IF TG_OP<>'INSERT' THEN o:=to_jsonb(OLD); eski:=(o->>'tenant_id')::uuid; END IF;
  IF (session_user='tekir_app' OR current_setting('role')='tekir_app') AND
    COALESCE(yeni,eski) IS DISTINCT FROM NULLIF(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'Kiraci baglami gecersiz' USING ERRCODE='42501'; END IF;
  IF kod='aylikFatura' THEN
    etkin_yeni:=n IS NOT NULL; etkin_eski:=o IS NOT NULL;
    yeni_ay:=date_trunc('month',(n->>'created_at')::timestamp+interval '3 hours')-interval '3 hours';
    eski_ay:=date_trunc('month',(o->>'created_at')::timestamp+interval '3 hours')-interval '3 hours';
  ELSE
    etkin_yeni:=COALESCE((n->>'aktif')::boolean,false) AND (kod<>'kullanici' OR n->>'rol'<>'calisan');
    etkin_eski:=COALESCE((o->>'aktif')::boolean,false) AND (kod<>'kullanici' OR o->>'rol'<>'calisan');
  END IF;
  IF (NOT etkin_yeni AND NOT etkin_eski) OR
    (etkin_yeni=etkin_eski AND yeni IS NOT DISTINCT FROM eski AND yeni_ay IS NOT DISTINCT FROM eski_ay) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  FOR tid IN SELECT DISTINCT x FROM unnest(ARRAY[eski,yeni]) x WHERE x IS NOT NULL ORDER BY x LOOP
    -- Satır gerçekten yazılır: REPEATABLE READ eski sayımla ikinci kayıt açamaz; 40001 ile yeniden dener.
    UPDATE tenant_abonelikleri SET kota_surumu=gen_random_uuid() WHERE tenant_id=tid;
  END LOOP;
  IF etkin_yeni THEN
    SELECT paket_kosullari INTO k FROM tenant_abonelikleri WHERE tenant_id=yeni;
    IF k->'semaSurumu'='2'::jsonb THEN
      kapsam:=k->'kapsamSozlesmesi';
      IF modul<>'' AND NOT (kapsam->'moduller' ? modul) THEN RAISE EXCEPTION 'paket_modul_kapali:%',modul; END IF;
      sinir:=(kapsam->'kotalar'->kod->>'sinir')::bigint;
      IF sinir IS NOT NULL THEN
        CASE kod
          WHEN 'kullanici' THEN SELECT count(*) INTO adet FROM users WHERE tenant_id=yeni AND aktif AND rol<>'calisan';
          WHEN 'cari' THEN SELECT count(*) INTO adet FROM cari_hesaplar WHERE tenant_id=yeni AND aktif;
          WHEN 'stok' THEN SELECT count(*) INTO adet FROM stok_kartlari WHERE tenant_id=yeni AND aktif;
          WHEN 'aylikFatura' THEN SELECT count(*) INTO adet FROM faturalar WHERE tenant_id=yeni AND created_at>=yeni_ay AND created_at<yeni_ay+interval '1 month';
        END CASE;
        IF adet>=sinir THEN RAISE EXCEPTION 'paket_kota_dolu:%',kod; END IF;
      END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER paket_kota BEFORE INSERT OR UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION paket_kotasini_koru('kullanici','');
CREATE TRIGGER paket_kota BEFORE INSERT OR UPDATE OR DELETE ON cari_hesaplar FOR EACH ROW EXECUTE FUNCTION paket_kotasini_koru('cari','cari');
CREATE TRIGGER paket_kota BEFORE INSERT OR UPDATE OR DELETE ON stok_kartlari FOR EACH ROW EXECUTE FUNCTION paket_kotasini_koru('stok','stok');
CREATE TRIGGER paket_kota BEFORE INSERT OR UPDATE OR DELETE ON faturalar FOR EACH ROW EXECUTE FUNCTION paket_kotasini_koru('aylikFatura','fatura');

CREATE OR REPLACE FUNCTION platform_paket_plan_denetle(p_id uuid,p_zamani_geldi boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE p platform_paket_atamalari; s platform_paket_surumleri; a tenant_abonelikleri; r jsonb; kullanim jsonb;
BEGIN
  SELECT * INTO p FROM platform_paket_atamalari WHERE id=p_id;
  IF NOT EXISTS (SELECT 1 FROM platform_kullanicilari WHERE id=p.kullanici_id AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN RETURN 'atama_yetki'; END IF;
  SELECT * INTO s FROM platform_paket_surumleri WHERE id=p.hedef_surum_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-paket:'||s.paket_id::text,0));
  SELECT * INTO s FROM platform_paket_surumleri WHERE id=p.hedef_surum_id;
  IF s.durum<>'yayinlandi' OR s.kilit_surumu<>p.hedef_kilit_surumu OR s.fiyatlandirma IS DISTINCT FROM p.veri->'fiyatlandirma'
    OR (p.atama_kapsami='kapsam' AND s.kapsam_sozlesmesi IS DISTINCT FROM p.veri->'hedefKapsam') THEN RETURN 'atama_hedef_degisti'; END IF;
  IF p_zamani_geldi AND (s.fiyatlandirma->>'gecerlilikTarihi')::date>(clock_timestamp() AT TIME ZONE 'Europe/Istanbul')::date THEN RETURN 'atama_fiyat_henuz_gecerli_degil'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p.veri->'kayitlar') ORDER BY value->>'tenantId' LOOP
    SELECT * INTO a FROM tenant_abonelikleri WHERE tenant_id=(r->>'tenantId')::uuid FOR UPDATE;
    IF NOT FOUND OR (to_jsonb(a)-'kota_surumu') IS DISTINCT FROM ((r->'abonelik')-'kota_surumu') THEN RETURN 'atama_kaynak_degisti'; END IF;
    IF p.atama_kapsami='kapsam' THEN
      IF a.kota_surumu::text IS DISTINCT FROM r->'abonelik'->>'kota_surumu' THEN RETURN 'atama_kaynak_degisti'; END IF;
      kullanim:=paket_kota_kullanimi(a.tenant_id);
      IF EXISTS (SELECT 1 FROM jsonb_each(s.kapsam_sozlesmesi->'kotalar') q
        WHERE q.value->'sinir'<>'null'::jsonb AND (kullanim->>q.key)::bigint>(q.value->>'sinir')::bigint) THEN RETURN 'atama_kota_asimi'; END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM platform_paket_atama_firmalari WHERE tenant_id=a.tenant_id AND atama_id<>p.id) THEN RETURN 'atama_plan_cakismasi'; END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION platform_paket_plan_denetle(uuid,boolean) FROM PUBLIC,tekir_app,tekir_platform;

CREATE OR REPLACE FUNCTION platform_paket_kapsam_atamasini_koru() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE kapsam jsonb;
BEGIN
  SELECT kapsam_sozlesmesi INTO kapsam FROM platform_paket_surumleri WHERE id=NEW.hedef_surum_id;
  IF NEW.atama_kapsami='fiyat' AND kapsam IS NOT NULL THEN RAISE EXCEPTION 'atama_kapsam_desteklenmiyor'; END IF;
  IF NEW.atama_kapsami='kapsam' AND (kapsam IS NULL OR kapsam IS DISTINCT FROM NEW.veri->'hedefKapsam') THEN RAISE EXCEPTION 'atama_kapsam_eksik'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION abonelik_paket_bagini_koru() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE sid uuid; k jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND (CASE WHEN NEW.plan_kodu='v1' THEN 'profesyonel' ELSE NEW.plan_kodu END)
    IS NOT DISTINCT FROM (CASE WHEN OLD.plan_kodu='v1' THEN 'profesyonel' ELSE OLD.plan_kodu END) THEN
    IF ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(OLD.paket_surum_id,OLD.paket_kosullari) THEN
      IF NOT EXISTS (SELECT 1 FROM platform_paket_atamalari p CROSS JOIN LATERAL jsonb_array_elements(p.veri->'kayitlar') r
        WHERE p.uygulandi_at IS NOT NULL AND p.xmin::text=pg_current_xact_id()::text
          AND p.hedef_surum_id=NEW.paket_surum_id AND ((r->'abonelik')-'kota_surumu')=(to_jsonb(OLD)-'kota_surumu') AND r->'hedefKosullar'=NEW.paket_kosullari
          AND (to_jsonb(NEW)-'paket_surum_id'-'paket_kosullari'-'updated_at')=(to_jsonb(OLD)-'paket_surum_id'-'paket_kosullari'-'updated_at')) THEN
        RAISE EXCEPTION 'Abonelik paket bagi veya korunmus kosullari degistirilemez';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND OLD.paket_kosullari->'semaSurumu'='2'::jsonb THEN RAISE EXCEPTION 'Kapsamli abonelik plani kontrollu kapsam atamasiyla degistirilmeli'; END IF;
  SELECT surum_id, kosullar INTO sid, k FROM abonelik_eski_paket_bagi(NEW.plan_kodu);
  IF TG_OP='INSERT' THEN
    IF (NEW.paket_surum_id IS NOT NULL OR NEW.paket_kosullari IS NOT NULL)
      AND ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(sid,k) THEN RAISE EXCEPTION 'Gecersiz abonelik paket bagi'; END IF;
  ELSE
    IF ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(OLD.paket_surum_id,OLD.paket_kosullari)
      AND ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(sid,k) THEN RAISE EXCEPTION 'Gecersiz abonelik paket gecisi'; END IF;
  END IF;
  NEW.paket_surum_id := sid; NEW.paket_kosullari := k;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION platform_paket_atama_hemen_uygula(p_kullanici uuid,p_onizleme uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE p platform_paket_atamalari; s platform_paket_surumleri; a tenant_abonelikleri; r jsonb; hata text;
  bugun date := (clock_timestamp() AT TIME ZONE 'Europe/Istanbul')::date;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki',0));
  IF NOT EXISTS (SELECT 1 FROM platform_kullanicilari WHERE id=p_kullanici AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN RAISE EXCEPTION 'atama_yetki'; END IF;
  SELECT * INTO p FROM platform_paket_atamalari WHERE id=p_onizleme AND kullanici_id=p_kullanici FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'atama_onizleme_yok'; END IF;
  IF p.uygulandi_at IS NOT NULL THEN RETURN jsonb_build_object('id',p.id,'tekrar',true,'uygulandiAt',p.uygulandi_at,'firmaAdedi',jsonb_array_length(p.veri->'kayitlar')); END IF;
  IF p.son_onay_at < clock_timestamp() OR p.uygulama_tarihi <> bugun THEN RAISE EXCEPTION 'atama_onizleme_suresi_doldu'; END IF;
  SELECT * INTO s FROM platform_paket_surumleri WHERE id=p.hedef_surum_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-paket:' || s.paket_id::text,0));
  SELECT * INTO s FROM platform_paket_surumleri WHERE id=p.hedef_surum_id;
  IF s.durum <> 'yayinlandi' OR s.kilit_surumu <> p.hedef_kilit_surumu OR s.fiyatlandirma IS DISTINCT FROM p.veri->'fiyatlandirma' THEN RAISE EXCEPTION 'atama_hedef_degisti'; END IF;
  -- Tüm kaynaklar önce kilitlenip doğrulanır; toplu işlem kısmi uygulanamaz.
  FOR r IN SELECT value FROM jsonb_array_elements(p.veri->'kayitlar') ORDER BY value->>'tenantId' LOOP
    SELECT * INTO a FROM tenant_abonelikleri WHERE tenant_id=(r->>'tenantId')::uuid FOR UPDATE;
    IF NOT FOUND OR (to_jsonb(a)-'kota_surumu') IS DISTINCT FROM ((r->'abonelik')-'kota_surumu') THEN RAISE EXCEPTION 'atama_kaynak_degisti'; END IF;
  END LOOP;
  IF p.son_onay_at < clock_timestamp() OR p.uygulama_tarihi <> (clock_timestamp() AT TIME ZONE 'Europe/Istanbul')::date THEN
    RAISE EXCEPTION 'atama_onizleme_suresi_doldu';
  END IF;
  IF p.atama_kapsami='kapsam' THEN
    hata := platform_paket_plan_denetle(p.id);
    IF hata IS NOT NULL THEN RAISE EXCEPTION '%',hata; END IF;
  END IF;
  UPDATE platform_paket_atamalari SET uygulandi_at=clock_timestamp() WHERE id=p.id RETURNING * INTO p;
  FOR r IN SELECT value FROM jsonb_array_elements(p.veri->'kayitlar') ORDER BY value->>'tenantId' LOOP
    UPDATE tenant_abonelikleri SET paket_surum_id=p.hedef_surum_id,paket_kosullari=r->'hedefKosullar',updated_at=clock_timestamp()
      WHERE tenant_id=(r->>'tenantId')::uuid;
  END LOOP;
  RETURN jsonb_build_object('id',p.id,'tekrar',false,'uygulandiAt',p.uygulandi_at,'firmaAdedi',jsonb_array_length(p.veri->'kayitlar'));
END $$;


CREATE FUNCTION platform_paket_kapsam_onizle(p_kullanici uuid, p_surum uuid, p_tenants uuid[], p_tarih date, p_neden text, p_tur text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE s platform_paket_surumleri; a tenant_abonelikleri; kayit platform_paket_atamalari;
  vade timestamptz; gun date; kod text; tid uuid; unvan text; k jsonb; limitler jsonb; kullanim jsonb; kaynaklar jsonb := '[]'; bugun date := (clock_timestamp() AT TIME ZONE 'Europe/Istanbul')::date;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki',0));
  IF NOT EXISTS (SELECT 1 FROM platform_kullanicilari WHERE id=p_kullanici AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN
    RAISE EXCEPTION 'atama_yetki';
  END IF;
  IF p_tur='bugun' THEN
    IF p_tarih IS DISTINCT FROM bugun THEN RAISE EXCEPTION 'atama_yalniz_bugun'; END IF;
    vade:=clock_timestamp();
  ELSIF p_tur='tarih' THEN
    IF p_tarih IS NULL OR p_tarih <= bugun OR p_tarih > bugun+366 THEN RAISE EXCEPTION 'atama_plan_tarih'; END IF;
    vade := p_tarih::timestamp AT TIME ZONE 'Europe/Istanbul';
  ELSIF p_tur='donem_sonu' THEN
    IF cardinality(p_tenants) IS DISTINCT FROM 1 OR p_tarih IS NOT NULL THEN RAISE EXCEPTION 'atama_plan_tek_firma'; END IF;
    SELECT donem_sonu AT TIME ZONE 'UTC' INTO vade FROM tenant_abonelikleri WHERE tenant_id=p_tenants[1];
    IF vade IS NULL OR vade <= clock_timestamp() OR vade > clock_timestamp()+interval '366 days' THEN RAISE EXCEPTION 'atama_plan_donem'; END IF;
  ELSE RAISE EXCEPTION 'atama_plan_tur'; END IF;
  gun := (vade AT TIME ZONE 'Europe/Istanbul')::date;
  IF p_neden IS NULL OR length(btrim(p_neden)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'atama_neden'; END IF;
  IF p_tenants IS NULL OR cardinality(p_tenants) NOT BETWEEN 1 AND 25 OR array_ndims(p_tenants) <> 1
    OR EXISTS (SELECT 1 FROM unnest(p_tenants) t WHERE t IS NULL)
    OR (SELECT count(DISTINCT t) FROM unnest(p_tenants) t) <> cardinality(p_tenants) THEN RAISE EXCEPTION 'atama_firma_secimi'; END IF;
  SELECT * INTO s FROM platform_paket_surumleri WHERE id=p_surum;
  IF NOT FOUND THEN RAISE EXCEPTION 'atama_surum_yok'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-paket:' || s.paket_id::text,0));
  SELECT * INTO s FROM platform_paket_surumleri WHERE id=p_surum;
  SELECT eski_plan_kodu INTO kod FROM platform_paketler WHERE id=s.paket_id;
  IF s.durum <> 'yayinlandi' OR s.fiyatlandirma IS NULL OR kod IS NULL THEN RAISE EXCEPTION 'atama_hedef_uygun_degil'; END IF;
  IF s.kapsam_sozlesmesi IS NULL THEN RAISE EXCEPTION 'atama_kapsam_eksik'; END IF;
  SELECT jsonb_object_agg(key,value->'sinir') INTO limitler FROM jsonb_each(s.kapsam_sozlesmesi->'kotalar');
  IF (s.fiyatlandirma->>'gecerlilikTarihi')::date > gun THEN RAISE EXCEPTION 'atama_fiyat_henuz_gecerli_degil'; END IF;
  FOR tid IN SELECT t FROM unnest(p_tenants) t ORDER BY t LOOP
    SELECT * INTO a FROM tenant_abonelikleri WHERE tenant_id=tid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'atama_abonelik_yok'; END IF;
    IF p_tur='donem_sonu' AND (a.donem_sonu AT TIME ZONE 'UTC') IS DISTINCT FROM vade THEN RAISE EXCEPTION 'atama_kaynak_degisti'; END IF;
    IF (CASE WHEN a.plan_kodu='v1' THEN 'profesyonel' ELSE a.plan_kodu END) <> kod
      OR a.paket_surum_id IS NULL OR a.paket_kosullari IS NULL
      OR a.paket_kosullari->'fiyatlandirma' IS NULL OR a.paket_kosullari->'fiyatlandirma' = 'null'::jsonb
      OR a.durum NOT IN ('aktif','deneme') THEN RAISE EXCEPTION 'atama_abonelik_uygun_degil'; END IF;
    IF a.paket_surum_id=s.id THEN RAISE EXCEPTION 'atama_zaten_hedefte'; END IF;
    -- Mevcut ödeme dönemleri kaldırılamaz; kayıtlı kart dönemi de korunmuş olur.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(a.paket_kosullari->'fiyatlandirma'->'donemler') d
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s.fiyatlandirma->'donemler') h WHERE h->'aySayisi'=d->'aySayisi')) THEN
      RAISE EXCEPTION 'atama_donem_eksik';
    END IF;
    SELECT t.unvan INTO unvan FROM tenants t WHERE t.id=tid;
    kullanim:=paket_kota_kullanimi(tid);
    IF EXISTS (SELECT 1 FROM jsonb_each(s.kapsam_sozlesmesi->'kotalar') q WHERE q.value->'sinir'<>'null'::jsonb AND (kullanim->>q.key)::bigint>(q.value->>'sinir')::bigint) THEN RAISE EXCEPTION 'atama_kota_asimi'; END IF;
    k := a.paket_kosullari || jsonb_build_object('semaSurumu',2,'kapsamSozlesmesi',s.kapsam_sozlesmesi,'limitler',limitler,'kaynak','katalog_atamasi','planAdi',s.ad,'fiyatlandirma',s.fiyatlandirma-'gecerlilikTarihi');
    kaynaklar := kaynaklar || jsonb_build_array(jsonb_build_object('tenantId',tid,'unvan',unvan,'abonelik',to_jsonb(a),'hedefKosullar',k,'kullanim',kullanim));
  END LOOP;
  INSERT INTO platform_paket_atamalari(kullanici_id,hedef_surum_id,hedef_kilit_surumu,uygulama_tarihi,neden,veri,uygulama_turu,uygulanacak_at,atama_kapsami)
    VALUES(p_kullanici,p_surum,s.kilit_surumu,gun,btrim(p_neden),jsonb_build_object('hedefPlanKodu',kod,'hedefPaketAdi',s.ad,'hedefSurumNo',s.surum_no,'hedefKapsam',s.kapsam_sozlesmesi,'fiyatlandirma',s.fiyatlandirma,'kayitlar',kaynaklar),p_tur,vade,'kapsam') RETURNING * INTO kayit;
  RETURN jsonb_build_object('atamaKapsami','kapsam','uygulamaTuru',kayit.uygulama_turu,'uygulanacakAt',kayit.uygulanacak_at,'id',kayit.id,'uygulamaTarihi',kayit.uygulama_tarihi,'sonOnayAt',kayit.son_onay_at,'neden',kayit.neden,'hedefSurumId',s.id,'veri',kayit.veri);
END $$;

REVOKE ALL ON FUNCTION platform_paket_kapsam_onizle(uuid,uuid,uuid[],date,text,text) FROM PUBLIC,tekir_app;
GRANT EXECUTE ON FUNCTION platform_paket_kapsam_onizle(uuid,uuid,uuid[],date,text,text) TO tekir_platform;
COMMIT;
