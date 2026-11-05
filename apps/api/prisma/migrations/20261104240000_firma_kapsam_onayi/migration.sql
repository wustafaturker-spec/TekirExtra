BEGIN;
CREATE OR REPLACE FUNCTION platform_firma_ozel_fiyat_onay(p_kullanici uuid,p_tenant uuid,p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE a tenant_abonelikleri; r platform_firma_istisna_taslaklari; beklenen jsonb; limitler jsonb; kullanim jsonb;
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
    kullanim:=paket_kota_kullanimi(p_tenant);
    IF EXISTS(SELECT 1 FROM jsonb_each(limitler) q WHERE q.value<>'null'::jsonb AND (kullanim->>q.key)::bigint>(q.value#>>'{}')::bigint) THEN RAISE EXCEPTION 'istisna_kota_asimi'; END IF;
  END IF;
  IF NOT(r.veri ? 'fiyatlandirma' OR r.veri ? 'kapsamSozlesmesi') OR beklenen IS DISTINCT FROM r.hedef_kosullar THEN RAISE EXCEPTION 'istisna_hedef_gecersiz'; END IF;
  IF EXISTS(SELECT 1 FROM platform_paket_atama_firmalari WHERE tenant_id=p_tenant) THEN RAISE EXCEPTION 'istisna_cakisma'; END IF;
  IF r.onay_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE platform_firma_istisna_taslaklari SET onay_at=clock_timestamp(),onaylayan_id=p_kullanici WHERE id=p_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION paket_kotasini_koru() RETURNS trigger
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
    SELECT abonelik_etkin_fiyat_kosullari(yeni) INTO k;
    IF k IS NOT NULL THEN
      kapsam:=k->'kapsamSozlesmesi';
      IF k->'semaSurumu'='2'::jsonb AND modul<>'' AND NOT (kapsam->'moduller' ? modul) THEN RAISE EXCEPTION 'paket_modul_kapali:%',modul; END IF;
      sinir:=(k->'limitler'->>kod)::bigint;
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

COMMIT;
