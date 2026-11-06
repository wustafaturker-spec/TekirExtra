BEGIN;
ALTER TABLE platform_duyuru_tercihleri
  ADD COLUMN son_gosterim_at timestamptz,
  ADD COLUMN tekrar_sonraki_gosterim timestamptz;

CREATE OR REPLACE FUNCTION tenant_duyurular(p_gecmis boolean,p_sayfa integer,p_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
 WITH kaynak AS (
  SELECT d.id,d.baslik,d.icerik,d.buton_metni AS "butonMetni",d.buton_url AS "butonUrl",
    COALESCE(d.hedef->'gosterimYerleri','["merkez"]'::jsonb) AS "gosterimYerleri",
    COALESCE(d.hedef->'modulYollari','[]'::jsonb) AS "modulYollari",
    COALESCE(d.hedef->>'tekrarPolitikasi','her_zaman') AS "tekrarPolitikasi",
    (p.son_gosterim_at IS NULL OR (COALESCE(d.hedef->>'tekrarPolitikasi','her_zaman') <> 'bir_kez'
      AND (p.tekrar_sonraki_gosterim IS NULL OR p.tekrar_sonraki_gosterim <= statement_timestamp()))) AS "tekrarGosterilebilir",
    p.tekrar_sonraki_gosterim AS "tekrarSonrakiGosterim",
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

CREATE OR REPLACE FUNCTION tenant_duyuru_olay(p_id uuid,p_tur text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE d platform_duyurular; v_gosterim_sayisi integer;
BEGIN
 IF p_tur NOT IN ('gosterim','okudum','tiklama') OR p_tur IS NULL THEN RAISE EXCEPTION 'Gecersiz duyuru olayi'; END IF;
 SELECT * INTO d FROM platform_duyurular WHERE id=p_id FOR SHARE;
 IF NOT FOUND OR d.durum <> 'yayinlandi' OR d.baslangic > clock_timestamp() OR d.bitis <= clock_timestamp()
   OR NOT EXISTS (SELECT 1 FROM duyuru_kiraci_kaynak() k WHERE k.id=p_id)
   OR (p_tur='tiklama' AND d.buton_url IS NULL) THEN RETURN false; END IF;
 IF p_tur='gosterim' THEN
   INSERT INTO platform_duyuru_tercihleri(duyuru_id,tenant_id,user_id,son_gosterim_at,tekrar_sonraki_gosterim)
   VALUES(p_id,NULLIF(current_setting('app.tenant_id',true),'')::uuid,NULLIF(current_setting('app.user_id',true),'')::uuid,
     clock_timestamp(),CASE d.hedef->>'tekrarPolitikasi'
       WHEN 'bir_kez' THEN NULL WHEN 'gunde_bir' THEN clock_timestamp()+interval '1 day'
       WHEN 'haftada_bir' THEN clock_timestamp()+interval '7 days' ELSE NULL END)
   ON CONFLICT (duyuru_id,tenant_id,user_id) DO UPDATE SET
     son_gosterim_at=clock_timestamp(),
     tekrar_sonraki_gosterim=CASE d.hedef->>'tekrarPolitikasi'
       WHEN 'bir_kez' THEN NULL WHEN 'gunde_bir' THEN clock_timestamp()+interval '1 day'
       WHEN 'haftada_bir' THEN clock_timestamp()+interval '7 days' ELSE NULL END,
     updated_at=clock_timestamp()
   WHERE (COALESCE(d.hedef->>'tekrarPolitikasi','her_zaman') <> 'bir_kez' OR platform_duyuru_tercihleri.son_gosterim_at IS NULL)
     AND (platform_duyuru_tercihleri.tekrar_sonraki_gosterim IS NULL OR platform_duyuru_tercihleri.tekrar_sonraki_gosterim <= clock_timestamp());
   GET DIAGNOSTICS v_gosterim_sayisi=ROW_COUNT;
   IF v_gosterim_sayisi=0 THEN RETURN false; END IF;
 END IF;
 INSERT INTO platform_duyuru_olaylari(duyuru_id,tenant_id,user_id,tur)
 VALUES(p_id,NULLIF(current_setting('app.tenant_id',true),'')::uuid,NULLIF(current_setting('app.user_id',true),'')::uuid,p_tur)
 ON CONFLICT DO NOTHING;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION tenant_duyuru_olay(uuid,text) FROM PUBLIC,tekir_platform;
GRANT EXECUTE ON FUNCTION tenant_duyuru_olay(uuid,text) TO tekir_app;
COMMIT;
