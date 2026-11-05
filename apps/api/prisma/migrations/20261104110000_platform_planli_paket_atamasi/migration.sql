BEGIN;
ALTER TABLE platform_paket_atamalari
  ADD COLUMN uygulama_turu text NOT NULL DEFAULT 'bugun' CHECK (uygulama_turu IN ('bugun','tarih','donem_sonu')),
  ADD COLUMN uygulanacak_at timestamptz(3),
  ADD COLUMN planlandi_at timestamptz(3),
  ADD COLUMN iptal_at timestamptz(3),
  ADD COLUMN iptal_eden_id uuid REFERENCES platform_kullanicilari(id) ON DELETE RESTRICT,
  ADD COLUMN iptal_nedeni text,
  ADD COLUMN engellendi_at timestamptz(3),
  ADD COLUMN engel_nedeni text;
CREATE INDEX platform_paket_atamalari_vade_idx ON platform_paket_atamalari(uygulanacak_at,id)
  WHERE planlandi_at IS NOT NULL AND uygulandi_at IS NULL AND iptal_at IS NULL AND engellendi_at IS NULL;
CREATE TABLE platform_paket_atama_firmalari (
  tenant_id uuid PRIMARY KEY,
  atama_id uuid NOT NULL REFERENCES platform_paket_atamalari(id) ON DELETE CASCADE
);
CREATE INDEX platform_paket_atama_firmalari_atama_idx ON platform_paket_atama_firmalari(atama_id);
REVOKE ALL ON platform_paket_atama_firmalari FROM PUBLIC, tekir_app, tekir_platform;
GRANT SELECT ON platform_paket_atama_firmalari TO tekir_platform;

CREATE FUNCTION platform_paket_plan_onizle(p_kullanici uuid, p_surum uuid, p_tenants uuid[], p_tarih date, p_neden text, p_tur text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE s platform_paket_surumleri; a tenant_abonelikleri; kayit platform_paket_atamalari;
  vade timestamptz; gun date; kod text; tid uuid; unvan text; k jsonb; kaynaklar jsonb := '[]'; bugun date := (clock_timestamp() AT TIME ZONE 'Europe/Istanbul')::date;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki',0));
  IF NOT EXISTS (SELECT 1 FROM platform_kullanicilari WHERE id=p_kullanici AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN
    RAISE EXCEPTION 'atama_yetki';
  END IF;
  IF p_tur='tarih' THEN
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
    k := a.paket_kosullari || jsonb_build_object('kaynak','katalog_atamasi','planAdi',s.ad,'fiyatlandirma',s.fiyatlandirma-'gecerlilikTarihi');
    kaynaklar := kaynaklar || jsonb_build_array(jsonb_build_object('tenantId',tid,'unvan',unvan,'abonelik',to_jsonb(a),'hedefKosullar',k));
  END LOOP;
  INSERT INTO platform_paket_atamalari(kullanici_id,hedef_surum_id,hedef_kilit_surumu,uygulama_tarihi,neden,veri,uygulama_turu,uygulanacak_at)
    VALUES(p_kullanici,p_surum,s.kilit_surumu,gun,btrim(p_neden),jsonb_build_object('hedefPlanKodu',kod,'hedefPaketAdi',s.ad,'hedefSurumNo',s.surum_no,'fiyatlandirma',s.fiyatlandirma,'kayitlar',kaynaklar),p_tur,vade) RETURNING * INTO kayit;
  RETURN jsonb_build_object('uygulamaTuru',kayit.uygulama_turu,'uygulanacakAt',kayit.uygulanacak_at,'id',kayit.id,'uygulamaTarihi',kayit.uygulama_tarihi,'sonOnayAt',kayit.son_onay_at,'neden',kayit.neden,'hedefSurumId',s.id,'veri',kayit.veri);
END $$;
REVOKE ALL ON FUNCTION platform_paket_plan_onizle(uuid,uuid,uuid[],date,text,text) FROM PUBLIC, tekir_app;
GRANT EXECUTE ON FUNCTION platform_paket_plan_onizle(uuid,uuid,uuid[],date,text,text) TO tekir_platform;

-- Onay ve worker aynı hedef/kaynak doğrulamasını kullanır; iş hatası kalıcı inceleme nedeni olabilir.
CREATE FUNCTION platform_paket_plan_denetle(p_id uuid,p_zamani_geldi boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE p platform_paket_atamalari; s platform_paket_surumleri; a tenant_abonelikleri; r jsonb;
BEGIN
  SELECT * INTO p FROM platform_paket_atamalari WHERE id=p_id;
  IF NOT EXISTS (SELECT 1 FROM platform_kullanicilari WHERE id=p.kullanici_id AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN RETURN 'atama_yetki'; END IF;
  SELECT * INTO s FROM platform_paket_surumleri WHERE id=p.hedef_surum_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-paket:' || s.paket_id::text,0));
  SELECT * INTO s FROM platform_paket_surumleri WHERE id=p.hedef_surum_id;
  IF s.durum <> 'yayinlandi' OR s.kilit_surumu <> p.hedef_kilit_surumu OR s.fiyatlandirma IS DISTINCT FROM p.veri->'fiyatlandirma' THEN RETURN 'atama_hedef_degisti'; END IF;
  IF p_zamani_geldi AND (s.fiyatlandirma->>'gecerlilikTarihi')::date > (clock_timestamp() AT TIME ZONE 'Europe/Istanbul')::date THEN RETURN 'atama_fiyat_henuz_gecerli_degil'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p.veri->'kayitlar') ORDER BY value->>'tenantId' LOOP
    SELECT * INTO a FROM tenant_abonelikleri WHERE tenant_id=(r->>'tenantId')::uuid FOR UPDATE;
    IF NOT FOUND OR to_jsonb(a) IS DISTINCT FROM r->'abonelik' THEN RETURN 'atama_kaynak_degisti'; END IF;
    IF EXISTS (SELECT 1 FROM platform_paket_atama_firmalari WHERE tenant_id=a.tenant_id AND atama_id<>p.id) THEN RETURN 'atama_plan_cakismasi'; END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION platform_paket_plan_denetle(uuid,boolean) FROM PUBLIC, tekir_app, tekir_platform;

ALTER FUNCTION platform_paket_atama_uygula(uuid,uuid) RENAME TO platform_paket_atama_hemen_uygula;
REVOKE ALL ON FUNCTION platform_paket_atama_hemen_uygula(uuid,uuid) FROM PUBLIC, tekir_app, tekir_platform;
CREATE FUNCTION platform_paket_atama_uygula(p_kullanici uuid,p_onizleme uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE p platform_paket_atamalari; r jsonb; hata text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki',0));
  IF NOT EXISTS (SELECT 1 FROM platform_kullanicilari WHERE id=p_kullanici AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN RAISE EXCEPTION 'atama_yetki'; END IF;
  SELECT * INTO p FROM platform_paket_atamalari WHERE id=p_onizleme AND kullanici_id=p_kullanici FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'atama_onizleme_yok'; END IF;
  IF p.uygulama_turu='bugun' THEN
    IF p.uygulandi_at IS NULL AND EXISTS (SELECT 1 FROM platform_paket_atama_firmalari f
      WHERE f.tenant_id IN (SELECT (value->>'tenantId')::uuid FROM jsonb_array_elements(p.veri->'kayitlar'))) THEN RAISE EXCEPTION 'atama_plan_cakismasi'; END IF;
    RETURN platform_paket_atama_hemen_uygula(p_kullanici,p_onizleme);
  END IF;
  IF p.iptal_at IS NOT NULL OR p.engellendi_at IS NOT NULL THEN RAISE EXCEPTION 'atama_plan_kapali'; END IF;
  IF p.planlandi_at IS NOT NULL THEN
    RETURN jsonb_build_object('id',p.id,'durum',CASE WHEN p.uygulandi_at IS NULL THEN 'planlandi' ELSE 'uygulandi' END,'tekrar',true,
      'planlandiAt',p.planlandi_at,'uygulandiAt',p.uygulandi_at,'firmaAdedi',jsonb_array_length(p.veri->'kayitlar'));
  END IF;
  IF p.son_onay_at < clock_timestamp() OR p.uygulanacak_at <= clock_timestamp() THEN RAISE EXCEPTION 'atama_onizleme_suresi_doldu'; END IF;
  hata := platform_paket_plan_denetle(p.id);
  IF hata IS NOT NULL THEN RAISE EXCEPTION '%',hata; END IF;
  IF p.son_onay_at < clock_timestamp() OR p.uygulanacak_at <= clock_timestamp() THEN RAISE EXCEPTION 'atama_onizleme_suresi_doldu'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p.veri->'kayitlar') LOOP
    INSERT INTO platform_paket_atama_firmalari(tenant_id,atama_id) VALUES((r->>'tenantId')::uuid,p.id);
  END LOOP;
  UPDATE platform_paket_atamalari SET planlandi_at=clock_timestamp() WHERE id=p.id RETURNING * INTO p;
  RETURN jsonb_build_object('id',p.id,'durum','planlandi','tekrar',false,'planlandiAt',p.planlandi_at,'uygulandiAt',NULL,'firmaAdedi',jsonb_array_length(p.veri->'kayitlar'));
END $$;
REVOKE ALL ON FUNCTION platform_paket_atama_uygula(uuid,uuid) FROM PUBLIC, tekir_app;
GRANT EXECUTE ON FUNCTION platform_paket_atama_uygula(uuid,uuid) TO tekir_platform;

CREATE FUNCTION platform_paket_plan_iptal(p_kullanici uuid,p_id uuid,p_neden text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE p platform_paket_atamalari;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki',0));
  IF NOT EXISTS (SELECT 1 FROM platform_kullanicilari WHERE id=p_kullanici AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN RAISE EXCEPTION 'atama_yetki'; END IF;
  IF p_neden IS NULL OR length(btrim(p_neden)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'atama_neden'; END IF;
  SELECT * INTO p FROM platform_paket_atamalari WHERE id=p_id AND planlandi_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'atama_onizleme_yok'; END IF;
  IF p.uygulandi_at IS NOT NULL THEN RAISE EXCEPTION 'atama_plan_uygulanmis'; END IF;
  IF p.iptal_at IS NOT NULL THEN RETURN jsonb_build_object('id',p.id,'tekrar',true); END IF;
  UPDATE platform_paket_atamalari SET iptal_at=clock_timestamp(),iptal_eden_id=p_kullanici,iptal_nedeni=btrim(p_neden) WHERE id=p.id;
  DELETE FROM platform_paket_atama_firmalari WHERE atama_id=p.id;
  RETURN jsonb_build_object('id',p.id,'tekrar',false);
END $$;
REVOKE ALL ON FUNCTION platform_paket_plan_iptal(uuid,uuid,text) FROM PUBLIC, tekir_app;
GRANT EXECUTE ON FUNCTION platform_paket_plan_iptal(uuid,uuid,text) TO tekir_platform;

CREATE FUNCTION platform_paket_plan_isle(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE p platform_paket_atamalari; r jsonb; hata text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki',0));
  SELECT * INTO p FROM platform_paket_atamalari WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR p.planlandi_at IS NULL OR p.uygulandi_at IS NOT NULL OR p.iptal_at IS NOT NULL OR p.engellendi_at IS NOT NULL OR p.uygulanacak_at > clock_timestamp() THEN
    RETURN jsonb_build_object('id',p_id,'durum','atlandi');
  END IF;
  hata := platform_paket_plan_denetle(p.id,true);
  IF hata IS NOT NULL THEN
    UPDATE platform_paket_atamalari SET engellendi_at=clock_timestamp(),engel_nedeni=hata WHERE id=p.id;
    -- İnceleme gerektiren fiyat geçişinde eski fiyatla tahsilata sessizce dönülmez.
    RETURN jsonb_build_object('id',p.id,'durum','inceleme','kullaniciId',p.kullanici_id,'engelNedeni',hata);
  END IF;
  UPDATE platform_paket_atamalari SET uygulandi_at=clock_timestamp() WHERE id=p.id;
  FOR r IN SELECT value FROM jsonb_array_elements(p.veri->'kayitlar') ORDER BY value->>'tenantId' LOOP
    UPDATE tenant_abonelikleri SET paket_surum_id=p.hedef_surum_id,paket_kosullari=r->'hedefKosullar',updated_at=clock_timestamp()
      WHERE tenant_id=(r->>'tenantId')::uuid;
  END LOOP;
  DELETE FROM platform_paket_atama_firmalari WHERE atama_id=p.id;
  RETURN jsonb_build_object('id',p.id,'durum','uygulandi','kullaniciId',p.kullanici_id);
END $$;
REVOKE ALL ON FUNCTION platform_paket_plan_isle(uuid) FROM PUBLIC, tekir_app;
GRANT EXECUTE ON FUNCTION platform_paket_plan_isle(uuid) TO tekir_platform;

-- Subscription row lock serializes a new payment quote with scheduling and activation.
CREATE FUNCTION abonelik_planli_atama_bekle_ic(p_tenant uuid,p_otomatik boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE donem timestamptz;
BEGIN
  SELECT donem_sonu AT TIME ZONE 'UTC' INTO donem FROM tenant_abonelikleri WHERE tenant_id=p_tenant FOR UPDATE;
  RETURN EXISTS (SELECT 1 FROM platform_paket_atama_firmalari f JOIN platform_paket_atamalari p ON p.id=f.atama_id
    WHERE f.tenant_id=p_tenant AND (p.uygulanacak_at <= clock_timestamp() OR (p_otomatik AND p.uygulanacak_at <= donem)));
END $$;
REVOKE ALL ON FUNCTION abonelik_planli_atama_bekle_ic(uuid,boolean) FROM PUBLIC, tekir_app, tekir_platform;
CREATE FUNCTION abonelik_planli_atama_bekle(p_otomatik boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE tid uuid := NULLIF(current_setting('app.tenant_id',true),'')::uuid;
BEGIN
  IF tid IS NULL THEN RAISE EXCEPTION 'Kiraci baglami gerekli'; END IF;
  RETURN abonelik_planli_atama_bekle_ic(tid,p_otomatik);
END $$;
REVOKE ALL ON FUNCTION abonelik_planli_atama_bekle(boolean) FROM PUBLIC, tekir_platform;
GRANT EXECUTE ON FUNCTION abonelik_planli_atama_bekle(boolean) TO tekir_app;
CREATE FUNCTION abonelik_planli_atama_odemeyi_koru() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
BEGIN
  IF abonelik_planli_atama_bekle_ic(NEW.tenant_id,NEW.kaynak='otomatik') THEN RAISE EXCEPTION 'planli_atama_odeme_bekliyor'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER abonelik_planli_atama_odeme BEFORE INSERT ON abonelik_odeme_denemeleri
  FOR EACH ROW EXECUTE FUNCTION abonelik_planli_atama_odemeyi_koru();
COMMIT;
