BEGIN;
-- Salt okunabilir onay/etki kaydı; uygulama rolüne hiçbir tablo yetkisi verilmez.
CREATE TABLE platform_paket_atamalari (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kullanici_id uuid NOT NULL REFERENCES platform_kullanicilari(id) ON DELETE RESTRICT,
  hedef_surum_id uuid NOT NULL REFERENCES platform_paket_surumleri(id) ON DELETE RESTRICT,
  hedef_kilit_surumu integer NOT NULL,
  uygulama_tarihi date NOT NULL,
  neden text NOT NULL CHECK (length(btrim(neden)) BETWEEN 5 AND 1000),
  veri jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  son_onay_at timestamptz(3) NOT NULL DEFAULT (clock_timestamp() + interval '15 minutes'),
  uygulandi_at timestamptz(3)
);
REVOKE ALL ON platform_paket_atamalari FROM PUBLIC, tekir_app, tekir_platform;
GRANT SELECT ON platform_paket_atamalari TO tekir_platform;
CREATE INDEX platform_paket_atamalari_kullanici_zaman_idx ON platform_paket_atamalari(kullanici_id, created_at DESC);

CREATE FUNCTION platform_paket_atama_onizle(p_kullanici uuid, p_surum uuid, p_tenants uuid[], p_tarih date, p_neden text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE s platform_paket_surumleri; a tenant_abonelikleri; kayit platform_paket_atamalari;
  kod text; tid uuid; unvan text; k jsonb; kaynaklar jsonb := '[]'; bugun date := (clock_timestamp() AT TIME ZONE 'Europe/Istanbul')::date;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki',0));
  IF NOT EXISTS (SELECT 1 FROM platform_kullanicilari WHERE id=p_kullanici AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN
    RAISE EXCEPTION 'atama_yetki';
  END IF;
  IF p_tarih IS DISTINCT FROM bugun THEN RAISE EXCEPTION 'atama_yalniz_bugun'; END IF;
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
  IF (s.fiyatlandirma->>'gecerlilikTarihi')::date > bugun THEN RAISE EXCEPTION 'atama_fiyat_henuz_gecerli_degil'; END IF;
  FOR tid IN SELECT t FROM unnest(p_tenants) t ORDER BY t LOOP
    SELECT * INTO a FROM tenant_abonelikleri WHERE tenant_id=tid;
    IF NOT FOUND THEN RAISE EXCEPTION 'atama_abonelik_yok'; END IF;
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
    k := a.paket_kosullari || jsonb_build_object('kaynak','katalog_atamasi','planAdi',s.ad,'fiyatlandirma',s.fiyatlandirma-'gecerlilikTarihi');
    kaynaklar := kaynaklar || jsonb_build_array(jsonb_build_object('tenantId',tid,'unvan',unvan,'abonelik',to_jsonb(a),'hedefKosullar',k));
  END LOOP;
  INSERT INTO platform_paket_atamalari(kullanici_id,hedef_surum_id,hedef_kilit_surumu,uygulama_tarihi,neden,veri)
    VALUES(p_kullanici,p_surum,s.kilit_surumu,p_tarih,btrim(p_neden),jsonb_build_object('hedefPlanKodu',kod,'hedefPaketAdi',s.ad,'hedefSurumNo',s.surum_no,'fiyatlandirma',s.fiyatlandirma,'kayitlar',kaynaklar)) RETURNING * INTO kayit;
  RETURN jsonb_build_object('id',kayit.id,'uygulamaTarihi',kayit.uygulama_tarihi,'sonOnayAt',kayit.son_onay_at,'neden',kayit.neden,'hedefSurumId',s.id,'veri',kayit.veri);
END $$;
REVOKE ALL ON FUNCTION platform_paket_atama_onizle(uuid,uuid,uuid[],date,text) FROM PUBLIC, tekir_app;
GRANT EXECUTE ON FUNCTION platform_paket_atama_onizle(uuid,uuid,uuid[],date,text) TO tekir_platform;

-- Aynı plan bağını ancak bu transaction'da onaylanan, eski satırı tam eşleşen kayıt değiştirebilir.
CREATE OR REPLACE FUNCTION abonelik_paket_bagini_koru() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE sid uuid; k jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND (CASE WHEN NEW.plan_kodu='v1' THEN 'profesyonel' ELSE NEW.plan_kodu END)
    IS NOT DISTINCT FROM (CASE WHEN OLD.plan_kodu='v1' THEN 'profesyonel' ELSE OLD.plan_kodu END) THEN
    IF ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(OLD.paket_surum_id,OLD.paket_kosullari) THEN
      IF NOT EXISTS (SELECT 1 FROM platform_paket_atamalari p CROSS JOIN LATERAL jsonb_array_elements(p.veri->'kayitlar') r
        WHERE p.uygulandi_at IS NOT NULL AND p.xmin::text=pg_current_xact_id()::text
          AND p.hedef_surum_id=NEW.paket_surum_id AND r->'abonelik'=to_jsonb(OLD) AND r->'hedefKosullar'=NEW.paket_kosullari
          AND (to_jsonb(NEW)-'paket_surum_id'-'paket_kosullari'-'updated_at')=(to_jsonb(OLD)-'paket_surum_id'-'paket_kosullari'-'updated_at')) THEN
        RAISE EXCEPTION 'Abonelik paket bagi veya korunmus kosullari degistirilemez';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
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

CREATE FUNCTION platform_paket_atama_uygula(p_kullanici uuid,p_onizleme uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE p platform_paket_atamalari; s platform_paket_surumleri; a tenant_abonelikleri; r jsonb;
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
    IF NOT FOUND OR to_jsonb(a) IS DISTINCT FROM r->'abonelik' THEN RAISE EXCEPTION 'atama_kaynak_degisti'; END IF;
  END LOOP;
  IF p.son_onay_at < clock_timestamp() OR p.uygulama_tarihi <> (clock_timestamp() AT TIME ZONE 'Europe/Istanbul')::date THEN
    RAISE EXCEPTION 'atama_onizleme_suresi_doldu';
  END IF;
  UPDATE platform_paket_atamalari SET uygulandi_at=clock_timestamp() WHERE id=p.id RETURNING * INTO p;
  FOR r IN SELECT value FROM jsonb_array_elements(p.veri->'kayitlar') ORDER BY value->>'tenantId' LOOP
    UPDATE tenant_abonelikleri SET paket_surum_id=p.hedef_surum_id,paket_kosullari=r->'hedefKosullar',updated_at=clock_timestamp()
      WHERE tenant_id=(r->>'tenantId')::uuid;
  END LOOP;
  RETURN jsonb_build_object('id',p.id,'tekrar',false,'uygulandiAt',p.uygulandi_at,'firmaAdedi',jsonb_array_length(p.veri->'kayitlar'));
END $$;
REVOKE ALL ON FUNCTION platform_paket_atama_uygula(uuid,uuid) FROM PUBLIC, tekir_app;
GRANT EXECUTE ON FUNCTION platform_paket_atama_uygula(uuid,uuid) TO tekir_platform;
COMMIT;
