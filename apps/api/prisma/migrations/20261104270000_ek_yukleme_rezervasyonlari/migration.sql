BEGIN;
CREATE TABLE ek_yukleme_rezervasyonlari (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  depo_anahtari text NOT NULL UNIQUE,
  bayt bigint NOT NULL CHECK(bayt BETWEEN 1 AND 10485760),
  durum text NOT NULL DEFAULT 'ayrildi' CHECK(durum IN ('ayrildi','tamamlandi','iptal')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  son_gecerlilik timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes',
  kapandi_at timestamptz,
  CHECK((durum='ayrildi')=(kapandi_at IS NULL))
);
CREATE INDEX ek_rezervasyon_tenant_idx ON ek_yukleme_rezervasyonlari(tenant_id,son_gecerlilik) WHERE durum='ayrildi';
ALTER TABLE ek_yukleme_rezervasyonlari ENABLE ROW LEVEL SECURITY;
ALTER TABLE ek_yukleme_rezervasyonlari FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ek_yukleme_rezervasyonlari FROM PUBLIC,tekir_app,tekir_platform;

CREATE FUNCTION ek_yukleme_ayir(p_id uuid,p_bayt bigint,p_anahtar text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE tid uuid:=NULLIF(current_setting('app.tenant_id',true),'')::uuid; r ek_yukleme_rezervasyonlari;
BEGIN
  IF tid IS NULL OR p_id IS NULL OR p_bayt IS NULL OR p_bayt NOT BETWEEN 1 AND 10485760 OR p_anahtar IS NULL OR strpos(p_anahtar,tid::text||'/')<>1 THEN RAISE EXCEPTION 'ek_rezervasyon_girdi'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ek-hacmi:'||tid::text,0));
  SELECT * INTO r FROM ek_yukleme_rezervasyonlari WHERE id=p_id FOR UPDATE;
  IF FOUND THEN
    IF r.tenant_id<>tid OR r.bayt<>p_bayt OR r.depo_anahtari<>p_anahtar OR r.durum<>'ayrildi' OR r.son_gecerlilik<=clock_timestamp() THEN RAISE EXCEPTION 'ek_rezervasyon_cakisma'; END IF;
    RETURN r.id;
  END IF;
  INSERT INTO ek_yukleme_rezervasyonlari(id,tenant_id,depo_anahtari,bayt) VALUES(p_id,tid,p_anahtar,p_bayt);
  RETURN p_id;
END $$;
CREATE FUNCTION ek_yukleme_kapat(p_id uuid,p_tamam boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE tid uuid:=NULLIF(current_setting('app.tenant_id',true),'')::uuid; r ek_yukleme_rezervasyonlari;
BEGIN
  IF tid IS NULL OR p_tamam IS NULL THEN RAISE EXCEPTION 'ek_rezervasyon_girdi'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ek-hacmi:'||tid::text,0));
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
REVOKE ALL ON FUNCTION ek_yukleme_ayir(uuid,bigint,text),ek_yukleme_kapat(uuid,boolean) FROM PUBLIC,tekir_platform;
GRANT EXECUTE ON FUNCTION ek_yukleme_ayir(uuid,bigint,text),ek_yukleme_kapat(uuid,boolean) TO tekir_app;
CREATE OR REPLACE FUNCTION platform_firma_ek_hacmi(p_kullanici uuid,p_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM platform_kullanicilari WHERE id=p_kullanici AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN RAISE EXCEPTION 'kota_yetki'; END IF;
  IF NOT EXISTS(SELECT 1 FROM tenants WHERE id=p_tenant) THEN RAISE EXCEPTION 'kota_firma_yok'; END IF;
  RETURN (WITH kaynak AS MATERIALIZED (SELECT sahip_tur,boyut FROM ekler WHERE tenant_id=p_tenant),
    gruplar AS (SELECT sahip_tur,count(*) AS adet,sum(boyut::bigint) AS bayt FROM kaynak GROUP BY sahip_tur)
    SELECT jsonb_build_object('tenantId',p_tenant,'olcumAt',statement_timestamp(),'dosyaAdedi',(SELECT count(*)::text FROM kaynak),
      'bayt',(SELECT COALESCE(sum(boyut::bigint),0)::text FROM kaynak),'kotaUygulaniyor',false,'bekleyenDosyaAdedi',(SELECT count(*)::text FROM ek_yukleme_rezervasyonlari WHERE tenant_id=p_tenant AND durum='ayrildi' AND son_gecerlilik>statement_timestamp()),'bekleyenBayt',(SELECT COALESCE(sum(bayt),0)::text FROM ek_yukleme_rezervasyonlari WHERE tenant_id=p_tenant AND durum='ayrildi' AND son_gecerlilik>statement_timestamp()),
      'dagilim',COALESCE((SELECT jsonb_agg(jsonb_build_object('sahipTur',sahip_tur,'dosyaAdedi',adet::text,'bayt',bayt::text) ORDER BY sahip_tur) FROM gruplar),'[]'::jsonb)));
END $$;

COMMIT;
