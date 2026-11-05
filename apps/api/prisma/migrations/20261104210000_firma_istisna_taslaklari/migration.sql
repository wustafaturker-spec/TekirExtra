BEGIN;
CREATE TABLE platform_firma_istisna_taslaklari (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  paket_surum_id uuid NOT NULL REFERENCES platform_paket_surumleri(id) ON DELETE RESTRICT,
  kullanici_id uuid NOT NULL REFERENCES platform_kullanicilari(id) ON DELETE RESTRICT,
  veri jsonb NOT NULL,
  kaynak_kosullar jsonb NOT NULL,
  hedef_kosullar jsonb NOT NULL,
  baslangic timestamptz NOT NULL,
  bitis timestamptz NOT NULL CHECK(bitis>baslangic),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  iptal_at timestamptz,
  iptal_eden_id uuid REFERENCES platform_kullanicilari(id) ON DELETE RESTRICT,
  iptal_nedeni text,
  CHECK ((iptal_at IS NULL AND iptal_eden_id IS NULL AND iptal_nedeni IS NULL)
    OR (iptal_at IS NOT NULL AND iptal_eden_id IS NOT NULL AND length(btrim(iptal_nedeni)) BETWEEN 5 AND 1000))
);
CREATE INDEX firma_istisna_taslak_tenant_idx ON platform_firma_istisna_taslaklari(tenant_id,created_at DESC,id);
ALTER TABLE platform_firma_istisna_taslaklari ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_firma_istisna_taslaklari FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_erisim ON platform_firma_istisna_taslaklari TO tekir_platform USING(true);
REVOKE ALL ON platform_firma_istisna_taslaklari FROM PUBLIC,tekir_app,tekir_platform;
GRANT SELECT ON platform_firma_istisna_taslaklari TO tekir_platform;
CREATE FUNCTION platform_firma_istisna_kaynak(p_tenant uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
  SELECT jsonb_build_object('planKodu',plan_kodu,'paketSurumId',paket_surum_id,'paketKosullari',paket_kosullari)
    FROM tenant_abonelikleri WHERE tenant_id=p_tenant
$$;
REVOKE ALL ON FUNCTION platform_firma_istisna_kaynak(uuid) FROM PUBLIC,tekir_app;
GRANT EXECUTE ON FUNCTION platform_firma_istisna_kaynak(uuid) TO tekir_platform;

-- Preparation records never change effective subscription conditions.
CREATE FUNCTION platform_firma_istisna_taslagi(p_kullanici uuid,p_tenant uuid,p_surum uuid,p_veri jsonb,p_kaynak jsonb,p_hedef jsonb,p_bas timestamptz,p_bit timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE aid uuid; a tenant_abonelikleri;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki',0));
  IF NOT EXISTS(SELECT 1 FROM platform_kullanicilari WHERE id=p_kullanici AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN RAISE EXCEPTION 'istisna_yetki'; END IF;
  SELECT * INTO a FROM tenant_abonelikleri WHERE tenant_id=p_tenant FOR UPDATE;
  IF NOT FOUND OR a.paket_surum_id IS DISTINCT FROM p_surum OR a.paket_kosullari IS DISTINCT FROM p_kaynak THEN RAISE EXCEPTION 'istisna_kaynak_degisti'; END IF;
  IF p_bas IS NULL OR p_bit IS NULL OR p_bit<=p_bas OR p_bit<=clock_timestamp() THEN RAISE EXCEPTION 'istisna_tarih'; END IF;
  IF EXISTS(SELECT 1 FROM platform_firma_istisna_taslaklari WHERE tenant_id=p_tenant AND iptal_at IS NULL AND baslangic<p_bit AND bitis>p_bas) THEN RAISE EXCEPTION 'istisna_cakisma'; END IF;
  INSERT INTO platform_firma_istisna_taslaklari(tenant_id,paket_surum_id,kullanici_id,veri,kaynak_kosullar,hedef_kosullar,baslangic,bitis)
    VALUES(p_tenant,p_surum,p_kullanici,p_veri,p_kaynak,p_hedef,p_bas,p_bit) RETURNING id INTO aid;
  RETURN aid;
END $$;
CREATE FUNCTION platform_firma_istisna_taslak_iptal(p_kullanici uuid,p_tenant uuid,p_id uuid,p_neden text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE r platform_firma_istisna_taslaklari;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki',0));
  IF NOT EXISTS(SELECT 1 FROM platform_kullanicilari WHERE id=p_kullanici AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN RAISE EXCEPTION 'istisna_yetki'; END IF;
  IF p_neden IS NULL OR length(btrim(p_neden)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'istisna_neden'; END IF;
  PERFORM 1 FROM tenant_abonelikleri WHERE tenant_id=p_tenant FOR UPDATE;
  SELECT * INTO r FROM platform_firma_istisna_taslaklari WHERE id=p_id AND tenant_id=p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'istisna_yok'; END IF;
  IF r.iptal_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE platform_firma_istisna_taslaklari SET iptal_at=clock_timestamp(),iptal_eden_id=p_kullanici,iptal_nedeni=btrim(p_neden) WHERE id=p_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION platform_firma_istisna_taslagi(uuid,uuid,uuid,jsonb,jsonb,jsonb,timestamptz,timestamptz),platform_firma_istisna_taslak_iptal(uuid,uuid,uuid,text) FROM PUBLIC,tekir_app;
GRANT EXECUTE ON FUNCTION platform_firma_istisna_taslagi(uuid,uuid,uuid,jsonb,jsonb,jsonb,timestamptz,timestamptz),platform_firma_istisna_taslak_iptal(uuid,uuid,uuid,text) TO tekir_platform;
COMMIT;
