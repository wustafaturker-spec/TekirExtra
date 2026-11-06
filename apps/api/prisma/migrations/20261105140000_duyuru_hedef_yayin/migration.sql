BEGIN;
ALTER TABLE platform_duyurular DROP CONSTRAINT platform_duyurular_durum_check;
ALTER TABLE platform_duyurular ADD CONSTRAINT platform_duyurular_durum_check CHECK (durum IN ('taslak','arsiv','yayinlandi','durduruldu'));
ALTER TABLE platform_duyurular ADD COLUMN hedef jsonb, ADD COLUMN baslangic timestamptz,
  ADD COLUMN bitis timestamptz, ADD COLUMN yayin_surumu integer;
ALTER TABLE platform_duyurular ADD CONSTRAINT duyuru_yayin_zamani CHECK (
  (yayin_surumu IS NULL AND hedef IS NULL AND baslangic IS NULL AND bitis IS NULL AND durum IN ('taslak','arsiv')) OR
  (yayin_surumu IS NOT NULL AND hedef IS NOT NULL AND baslangic IS NOT NULL AND bitis > baslangic AND durum IN ('yayinlandi','durduruldu','arsiv')));
CREATE OR REPLACE FUNCTION platform_duyuru_koru() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.surum <> OLD.surum + 1 OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Duyuru kimligi ve surum sirasi korunmalidir';
  END IF;
  IF OLD.durum = 'arsiv' OR (OLD.durum <> 'taslak' AND (
    ROW(NEW.baslik,NEW.icerik,NEW.buton_metni,NEW.buton_url,NEW.hedef,NEW.baslangic,NEW.bitis,NEW.yayin_surumu)
      IS DISTINCT FROM ROW(OLD.baslik,OLD.icerik,OLD.buton_metni,OLD.buton_url,OLD.hedef,OLD.baslangic,OLD.bitis,OLD.yayin_surumu)
    OR NOT ((OLD.durum='yayinlandi' AND NEW.durum IN ('durduruldu','arsiv')) OR (OLD.durum='durduruldu' AND NEW.durum='arsiv')))) THEN
    RAISE EXCEPTION 'Yayinlanmis duyuru icerigi veya arsivi degistirilemez';
  END IF;
  IF OLD.durum='taslak' AND NEW.durum NOT IN ('taslak','arsiv','yayinlandi') THEN RAISE EXCEPTION 'Gecersiz yayin gecisi'; END IF;
  IF OLD.durum='taslak' AND NEW.durum='yayinlandi' AND NEW.yayin_surumu IS DISTINCT FROM NEW.surum THEN RAISE EXCEPTION 'Gecersiz yayin surumu'; END IF;
  RETURN NEW;
END $$;

CREATE TABLE platform_duyuru_onizlemeleri (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  duyuru_id uuid NOT NULL REFERENCES platform_duyurular(id) ON DELETE RESTRICT,
  kullanici_id uuid NOT NULL REFERENCES platform_kullanicilari(id) ON DELETE RESTRICT,
  surum integer NOT NULL, hedef jsonb NOT NULL, baslangic timestamptz, bitis timestamptz NOT NULL,
  firma_sayisi integer NOT NULL, kullanici_sayisi integer NOT NULL, parmak_izi text NOT NULL,
  son_onay_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  uygulandi_at timestamptz
);
CREATE INDEX duyuru_onizlemeleri_duyuru ON platform_duyuru_onizlemeleri(duyuru_id);
CREATE UNIQUE INDEX users_tenant_id_id_duyuru_key ON users(tenant_id,id);
CREATE TABLE platform_duyuru_alicilari (
  duyuru_id uuid NOT NULL REFERENCES platform_duyurular(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  PRIMARY KEY (duyuru_id,tenant_id,user_id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX duyuru_alicilari_kullanici ON platform_duyuru_alicilari(tenant_id,user_id,duyuru_id);
CREATE TABLE platform_duyuru_olaylari (
  duyuru_id uuid NOT NULL, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
  tur text NOT NULL CHECK (tur IN ('gosterim','okudum','tiklama')),
  zaman timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (duyuru_id,tenant_id,user_id,tur),
  FOREIGN KEY (duyuru_id,tenant_id,user_id) REFERENCES platform_duyuru_alicilari(duyuru_id,tenant_id,user_id) ON DELETE RESTRICT
);
REVOKE ALL ON platform_duyuru_onizlemeleri,platform_duyuru_alicilari,platform_duyuru_olaylari FROM PUBLIC,tekir_app,tekir_platform;
GRANT SELECT,INSERT,UPDATE ON platform_duyuru_onizlemeleri TO tekir_platform;
GRANT SELECT,INSERT ON platform_duyuru_alicilari TO tekir_platform;
GRANT SELECT ON platform_duyuru_olaylari TO tekir_platform;
ALTER TABLE platform_duyuru_onizlemeleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_duyuru_onizlemeleri FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_duyuru_alicilari ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_duyuru_alicilari FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_duyuru_olaylari ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_duyuru_olaylari FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_erisim ON platform_duyuru_onizlemeleri TO tekir_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_erisim ON platform_duyuru_alicilari TO tekir_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_erisim ON platform_duyuru_olaylari TO tekir_platform USING (true);
-- Kiracı rolüne tablo yetkisi verilmez. Kimlik, aşağıdaki dar işlevlerde istek bağlamından alınır.
CREATE FUNCTION duyuru_hedef_alicilari(g jsonb, p_tenant uuid DEFAULT NULL, p_user uuid DEFAULT NULL)
RETURNS TABLE(tenant_id uuid,user_id uuid,unvan text) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp SET row_security = off AS $$
  SELECT t.id,u.id,t.unvan FROM tenants t JOIN users u ON u.tenant_id=t.id
  LEFT JOIN tenant_abonelikleri a ON a.tenant_id=t.id
  LEFT JOIN platform_paket_surumleri s ON s.id=a.paket_surum_id
  WHERE u.aktif AND (p_tenant IS NULL OR t.id=p_tenant) AND (p_user IS NULL OR u.id=p_user)
    AND (g->>'kapsam'='tum' OR (g->'firmaIds') ? t.id::text)
    AND NOT ((g->'haricFirmaIds') ? t.id::text)
    AND (jsonb_array_length(g->'paketIds')=0 OR (g->'paketIds') ? s.paket_id::text)
    AND (jsonb_array_length(g->'durumlar')=0 OR (g->'durumlar') ? a.durum::text)
    AND (g->'roller') ? u.rol::text
$$;
REVOKE ALL ON FUNCTION duyuru_hedef_alicilari(jsonb,uuid,uuid) FROM PUBLIC,tekir_app;
GRANT EXECUTE ON FUNCTION duyuru_hedef_alicilari(jsonb,uuid,uuid) TO tekir_platform;

-- Alıcı listesi yalnız yayın transaction'ında oluşturulur; sonraki kullanıcılar eklenemez.
CREATE FUNCTION duyuru_alici_koru() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp SET row_security = off AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM platform_duyurular d WHERE d.id=NEW.duyuru_id AND d.durum='yayinlandi'
   AND d.yayin_surumu=d.surum AND d.xmin::text=pg_current_xact_id()::text
   AND EXISTS (SELECT 1 FROM duyuru_hedef_alicilari(d.hedef,NEW.tenant_id,NEW.user_id))) THEN
   RAISE EXCEPTION 'Duyuru alicisi yalniz yayin transactioninda eklenebilir';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION duyuru_alici_koru() FROM PUBLIC,tekir_app,tekir_platform;
CREATE TRIGGER duyuru_alici_koru BEFORE INSERT ON platform_duyuru_alicilari FOR EACH ROW EXECUTE FUNCTION duyuru_alici_koru();

CREATE FUNCTION duyuru_kiraci_kaynak() RETURNS SETOF platform_duyurular
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
 SELECT d.* FROM platform_duyurular d JOIN platform_duyuru_alicilari a ON a.duyuru_id=d.id
 WHERE a.tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid
   AND a.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
   AND d.durum='yayinlandi' AND d.baslangic <= statement_timestamp()
   AND EXISTS (SELECT 1 FROM duyuru_hedef_alicilari(d.hedef,a.tenant_id,a.user_id))
$$;
REVOKE ALL ON FUNCTION duyuru_kiraci_kaynak() FROM PUBLIC,tekir_app,tekir_platform;

CREATE FUNCTION tenant_duyurular(p_gecmis boolean,p_sayfa integer,p_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
 WITH kaynak AS (
  SELECT d.id,d.baslik,d.icerik,d.buton_metni AS "butonMetni",d.buton_url AS "butonUrl",
    d.yayin_surumu AS surum,d.baslangic,d.bitis,
    EXISTS (SELECT 1 FROM platform_duyuru_olaylari o WHERE o.duyuru_id=d.id
      AND o.tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid
      AND o.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND o.tur='okudum') AS okundu
  FROM duyuru_kiraci_kaynak() d WHERE (p_id IS NULL OR d.id=p_id)
    AND CASE WHEN p_gecmis THEN d.bitis <= statement_timestamp() ELSE d.bitis > statement_timestamp() END
 ), sayfa AS (SELECT * FROM kaynak ORDER BY baslangic DESC,id DESC LIMIT 25 OFFSET (greatest(1,least(p_sayfa,100000))-1)*25)
 SELECT jsonb_build_object('kayitlar',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY baslangic DESC,id DESC) FROM sayfa s),'[]'::jsonb),
  'toplam',(SELECT count(*) FROM kaynak),'sayfa',p_sayfa,'sayfaBoyutu',25)
$$;
CREATE FUNCTION tenant_duyuru_olay(p_id uuid,p_tur text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE d platform_duyurular;
BEGIN
 IF p_tur NOT IN ('gosterim','okudum','tiklama') OR p_tur IS NULL THEN RAISE EXCEPTION 'Gecersiz duyuru olayi'; END IF;
 -- Durdurma/yayın değişikliğiyle aynı satır kilidi: biten yayın için olay yazılmaz.
 SELECT * INTO d FROM platform_duyurular WHERE id=p_id FOR SHARE;
 IF NOT FOUND OR d.durum <> 'yayinlandi' OR d.baslangic > clock_timestamp() OR d.bitis <= clock_timestamp()
   OR NOT EXISTS (SELECT 1 FROM duyuru_kiraci_kaynak() k WHERE k.id=p_id)
   OR (p_tur='tiklama' AND d.buton_url IS NULL) THEN RETURN false; END IF;
 INSERT INTO platform_duyuru_olaylari(duyuru_id,tenant_id,user_id,tur)
 VALUES(p_id,NULLIF(current_setting('app.tenant_id',true),'')::uuid,NULLIF(current_setting('app.user_id',true),'')::uuid,p_tur)
 ON CONFLICT DO NOTHING;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION tenant_duyurular(boolean,integer,uuid),tenant_duyuru_olay(uuid,text) FROM PUBLIC,tekir_platform;
GRANT EXECUTE ON FUNCTION tenant_duyurular(boolean,integer,uuid),tenant_duyuru_olay(uuid,text) TO tekir_app;
COMMIT;
