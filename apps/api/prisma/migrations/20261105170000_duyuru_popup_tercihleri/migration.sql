BEGIN;
CREATE TABLE platform_duyuru_tercihleri (
  duyuru_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  ertelendi_at timestamptz,
  sonraki_gosterim timestamptz,
  kapatildi_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (duyuru_id,tenant_id,user_id),
  FOREIGN KEY (duyuru_id,tenant_id,user_id) REFERENCES platform_duyuru_alicilari(duyuru_id,tenant_id,user_id) ON DELETE RESTRICT,
  CHECK ((ertelendi_at IS NULL) = (sonraki_gosterim IS NULL))
);
CREATE INDEX duyuru_tercihleri_tenant_user ON platform_duyuru_tercihleri(tenant_id,user_id,sonraki_gosterim);
REVOKE ALL ON platform_duyuru_tercihleri FROM PUBLIC,tekir_app,tekir_platform;
GRANT SELECT ON platform_duyuru_tercihleri TO tekir_platform;
ALTER TABLE platform_duyuru_tercihleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_duyuru_tercihleri FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_erisim ON platform_duyuru_tercihleri TO tekir_platform USING (true);

CREATE OR REPLACE FUNCTION tenant_duyurular(p_gecmis boolean,p_sayfa integer,p_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
 WITH kaynak AS (
  SELECT d.id,d.baslik,d.icerik,d.buton_metni AS "butonMetni",d.buton_url AS "butonUrl",
    COALESCE(d.hedef->'gosterimYerleri','["merkez"]'::jsonb) AS "gosterimYerleri",
    COALESCE((d.hedef->>'popupOnceligi')::integer,50) AS "popupOnceligi",
    COALESCE(d.hedef->>'popupTuru','normal') AS "popupTuru",
    COALESCE((d.hedef->>'ertelemeDakika')::integer,1440) AS "ertelemeDakika",
    p.ertelendi_at AS "ertelendiAt",p.sonraki_gosterim AS "sonrakiGosterim",
    (p.kapatildi_at IS NOT NULL) AS "popupKapatildi",
    d.yayin_surumu AS surum,d.baslangic,d.bitis,
    EXISTS (SELECT 1 FROM platform_duyuru_olaylari o WHERE o.duyuru_id=d.id
      AND o.tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid
      AND o.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND o.tur='okudum') AS okundu
  FROM duyuru_kiraci_kaynak() d
  LEFT JOIN platform_duyuru_tercihleri p ON p.duyuru_id=d.id
    AND p.tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid
    AND p.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
  WHERE (p_id IS NULL OR d.id=p_id)
    AND CASE WHEN p_gecmis THEN d.bitis <= statement_timestamp() ELSE d.bitis > statement_timestamp() END
 ), sayfa AS (SELECT * FROM kaynak ORDER BY baslangic DESC,id DESC LIMIT 25 OFFSET (greatest(1,least(p_sayfa,100000))-1)*25)
 SELECT jsonb_build_object('kayitlar',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY baslangic DESC,id DESC) FROM sayfa s),'[]'::jsonb),
  'toplam',(SELECT count(*) FROM kaynak),'sayfa',p_sayfa,'sayfaBoyutu',25)
$$;
REVOKE ALL ON FUNCTION tenant_duyurular(boolean,integer,uuid) FROM PUBLIC,tekir_platform;
GRANT EXECUTE ON FUNCTION tenant_duyurular(boolean,integer,uuid) TO tekir_app;

CREATE FUNCTION tenant_duyuru_tercihi(p_id uuid,p_tur text)
RETURNS TABLE(uygun boolean,sonraki_gosterim timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE d platform_duyurular; v_tenant uuid; v_user uuid; v_dakika integer; v_sonraki timestamptz;
BEGIN
  IF p_tur NOT IN ('ertele','kapat') OR p_tur IS NULL THEN RAISE EXCEPTION 'Gecersiz duyuru tercihi'; END IF;
  v_tenant := NULLIF(current_setting('app.tenant_id',true),'')::uuid;
  v_user := NULLIF(current_setting('app.user_id',true),'')::uuid;
  SELECT * INTO d FROM platform_duyurular WHERE id=p_id FOR SHARE;
  IF NOT FOUND OR d.durum <> 'yayinlandi' OR d.baslangic > clock_timestamp() OR d.bitis <= clock_timestamp()
    OR NOT (COALESCE(d.hedef->'gosterimYerleri','[]'::jsonb) ? 'popup')
    OR NOT EXISTS (SELECT 1 FROM duyuru_kiraci_kaynak() k WHERE k.id=p_id) THEN
    RETURN QUERY SELECT false,NULL::timestamptz; RETURN;
  END IF;
  v_dakika := CASE WHEN d.hedef->>'ertelemeDakika' IN ('60','1440','10080') THEN (d.hedef->>'ertelemeDakika')::integer ELSE 1440 END;
  v_sonraki := CASE WHEN p_tur='ertele' THEN clock_timestamp() + make_interval(mins => v_dakika) ELSE NULL END;
  INSERT INTO platform_duyuru_tercihleri(duyuru_id,tenant_id,user_id,ertelendi_at,sonraki_gosterim,kapatildi_at)
  VALUES(p_id,v_tenant,v_user,CASE WHEN p_tur='ertele' THEN clock_timestamp() END,v_sonraki,CASE WHEN p_tur='kapat' THEN clock_timestamp() END)
  ON CONFLICT (duyuru_id,tenant_id,user_id) DO UPDATE SET
    ertelendi_at=CASE WHEN p_tur='ertele' THEN clock_timestamp() ELSE platform_duyuru_tercihleri.ertelendi_at END,
    sonraki_gosterim=CASE WHEN p_tur='ertele' THEN EXCLUDED.sonraki_gosterim ELSE platform_duyuru_tercihleri.sonraki_gosterim END,
    kapatildi_at=CASE WHEN p_tur='kapat' THEN clock_timestamp() ELSE platform_duyuru_tercihleri.kapatildi_at END,
    updated_at=clock_timestamp();
  RETURN QUERY SELECT true,v_sonraki;
END $$;
REVOKE ALL ON FUNCTION tenant_duyuru_tercihi(uuid,text) FROM PUBLIC,tekir_platform;
GRANT EXECUTE ON FUNCTION tenant_duyuru_tercihi(uuid,text) TO tekir_app;
COMMIT;
