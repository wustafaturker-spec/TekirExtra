BEGIN;
-- Placement travels with the frozen publication target and is exposed only by
-- the tenant-scoped definer function. Older rows continue to render centrally.
CREATE OR REPLACE FUNCTION tenant_duyurular(p_gecmis boolean,p_sayfa integer,p_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
 WITH kaynak AS (
  SELECT d.id,d.baslik,d.icerik,d.buton_metni AS "butonMetni",d.buton_url AS "butonUrl",
    COALESCE(d.hedef->'gosterimYerleri','["merkez"]'::jsonb) AS "gosterimYerleri",
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
REVOKE ALL ON FUNCTION tenant_duyurular(boolean,integer,uuid) FROM PUBLIC,tekir_platform;
GRANT EXECUTE ON FUNCTION tenant_duyurular(boolean,integer,uuid) TO tekir_app;
COMMIT;
