BEGIN;
ALTER TABLE tenant_abonelikleri ADD COLUMN paket_surum_id uuid REFERENCES platform_paket_surumleri(id) ON DELETE RESTRICT;
ALTER TABLE tenant_abonelikleri ADD COLUMN paket_kosullari jsonb;
ALTER TABLE tenant_abonelikleri ADD CONSTRAINT abonelik_paket_bagi_tam CHECK ((paket_surum_id IS NULL) = (paket_kosullari IS NULL));
CREATE INDEX tenant_abonelikleri_paket_surum_idx ON tenant_abonelikleri(paket_surum_id);

-- Katalog tanımı v1'e referans verir; fiyatı katalogdan tahmin etmez.
-- Mevcut üç planın bilinen eski fiyat/limit sözleşmesi korunur.
CREATE FUNCTION abonelik_eski_paket_bagi(p_plan text)
RETURNS TABLE (surum_id uuid, kosullar jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE v_kod text := CASE WHEN p_plan = 'v1' THEN 'profesyonel' ELSE p_plan END;
  ad text; aylik numeric; limitler jsonb; fiyat jsonb; sid uuid;
BEGIN
  CASE v_kod
    WHEN 'baslangic' THEN ad := 'Başlangıç'; aylik := 399; limitler := '{"kullanici":3,"cari":250,"stok":500,"aylikFatura":100}';
    WHEN 'profesyonel' THEN ad := 'Profesyonel'; aylik := 999; limitler := '{"kullanici":10,"cari":2500,"stok":5000,"aylikFatura":1000}';
    WHEN 'kurumsal' THEN ad := 'Kurumsal'; aylik := NULL; limitler := '{"kullanici":null,"cari":null,"stok":null,"aylikFatura":null}';
    ELSE RETURN;
  END CASE;
  SELECT s.id INTO sid FROM platform_paketler p JOIN platform_paket_surumleri s ON s.paket_id = p.id AND s.surum_no = 1
    WHERE p.eski_plan_kodu = v_kod AND s.durum IN ('yayinlandi','arsiv');
  IF sid IS NULL THEN RAISE EXCEPTION 'Eski plan katalog kaynak surumu bulunamadi: %', v_kod; END IF;
  IF aylik IS NOT NULL THEN
    SELECT jsonb_build_object('paraBirimi','TRY','vergiDahil',false,'kdvOrani','20','donemler',
      jsonb_agg(jsonb_build_object('aySayisi',ay,'matrah',to_char(aylik * ay,'FM999999999999990.00')) ORDER BY ay))
      INTO fiyat FROM unnest(ARRAY[1,3,6,12]) ay;
  END IF;
  RETURN QUERY SELECT sid, jsonb_build_object('semaSurumu',1,'kaynak','eski_plan_gecisi','planKodu',v_kod,'planAdi',ad,'limitler',limitler,'fiyatlandirma',fiyat);
END $$;
REVOKE ALL ON FUNCTION abonelik_eski_paket_bagi(text) FROM PUBLIC, tekir_app, tekir_platform;

-- Yalnız yeni sütunlar yazılır: kod, dönem, durum, meta ve updated_at korunur.
WITH baglar AS MATERIALIZED (
  SELECT a.id, b.surum_id, b.kosullar FROM tenant_abonelikleri a CROSS JOIN LATERAL abonelik_eski_paket_bagi(a.plan_kodu) b
)
UPDATE tenant_abonelikleri a SET paket_surum_id = b.surum_id, paket_kosullari = b.kosullar FROM baglar b WHERE a.id = b.id;

CREATE FUNCTION abonelik_paket_bagini_koru() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE sid uuid; k jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.plan_kodu IS NOT DISTINCT FROM OLD.plan_kodu THEN
    IF ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(OLD.paket_surum_id,OLD.paket_kosullari) THEN
      RAISE EXCEPTION 'Abonelik paket bagi veya korunmus kosullari degistirilemez';
    END IF;
    RETURN NEW;
  END IF;
  SELECT surum_id, kosullar INTO sid, k FROM abonelik_eski_paket_bagi(NEW.plan_kodu);
  IF TG_OP = 'INSERT' THEN
    IF (NEW.paket_surum_id IS NOT NULL OR NEW.paket_kosullari IS NOT NULL)
      AND ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(sid,k) THEN
      RAISE EXCEPTION 'Gecersiz abonelik paket bagi';
    END IF;
  ELSE
    IF ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(OLD.paket_surum_id,OLD.paket_kosullari)
      AND ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(sid,k) THEN
      RAISE EXCEPTION 'Gecersiz abonelik paket gecisi';
    END IF;
  END IF;
  NEW.paket_surum_id := sid; NEW.paket_kosullari := k;
  RETURN NEW;
END $$;
CREATE TRIGGER abonelik_paket_bagi BEFORE INSERT OR UPDATE ON tenant_abonelikleri FOR EACH ROW EXECUTE FUNCTION abonelik_paket_bagini_koru();

-- Aynı SELECT'te abonelikle aynı snapshot: önizleme farklı fiyat kaynağı okumaz.
DROP FUNCTION platform_yaklasan_yenilemeler(integer);
CREATE FUNCTION platform_yaklasan_yenilemeler(p_gun integer)
RETURNS TABLE (
  tenant_id uuid, unvan text, plan_kodu text, durum text, donem_sonu timestamp,
  kart_var boolean, saglayici text, son4 text, kart_markasi text, otomatik_yenileme boolean, kart_ay_sayisi integer,
  paket_surum_id uuid, paket_kosullari jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
BEGIN
  IF p_gun IS NULL OR p_gun < 1 OR p_gun > 90 THEN RAISE EXCEPTION 'gecersiz_gun' USING ERRCODE = 'P0001'; END IF;
  RETURN QUERY SELECT a.tenant_id,t.unvan::text,a.plan_kodu::text,a.durum::text,a.donem_sonu,
    k.tenant_id IS NOT NULL,k.saglayici::text,k.son4::text,k.kart_markasi::text,k.otomatik_yenileme,k.ay_sayisi,a.paket_surum_id,a.paket_kosullari
    FROM tenant_abonelikleri a JOIN tenants t ON t.id = a.tenant_id LEFT JOIN abonelik_kartlari k ON k.tenant_id = a.tenant_id
    WHERE a.donem_sonu IS NOT NULL AND a.durum <> 'iptal' AND a.donem_sonu < now() + make_interval(days => p_gun)
    ORDER BY a.donem_sonu;
END $$;
REVOKE ALL ON FUNCTION platform_yaklasan_yenilemeler(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_yaklasan_yenilemeler(integer) TO tekir_platform;

-- Yalnız yönetim raporu; uygulama rolü tüm aboneliklerin bağını listeleyemez.
CREATE FUNCTION platform_abonelik_katalog_durumu(p_sayfa integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
BEGIN
  IF p_sayfa IS NULL OR p_sayfa NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'gecersiz_sayfa'; END IF;
  RETURN (WITH kaynak AS MATERIALIZED (
    SELECT a.tenant_id, t.unvan, a.plan_kodu, a.paket_surum_id, a.paket_kosullari,
      CASE WHEN a.paket_surum_id IS NOT NULL THEN 'bagli' ELSE 'bilinmeyen_plan' END AS durum
    FROM tenant_abonelikleri a JOIN tenants t ON t.id = a.tenant_id
  ), sayfa AS (SELECT * FROM kaynak ORDER BY (durum = 'bilinmeyen_plan') DESC, unvan, tenant_id LIMIT 25 OFFSET ((p_sayfa - 1)::bigint * 25))
  SELECT jsonb_build_object('toplam',(SELECT count(*) FROM kaynak),'bagli',(SELECT count(*) FROM kaynak WHERE durum='bagli'),
    'bilinmeyenPlan',(SELECT count(*) FROM kaynak WHERE durum='bilinmeyen_plan'),'sayfa',p_sayfa,'sayfaBoyutu',25,
    'kayitlar',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY (durum='bilinmeyen_plan') DESC,unvan,tenant_id) FROM sayfa s),'[]'::jsonb)));
END $$;
REVOKE ALL ON FUNCTION platform_abonelik_katalog_durumu(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_abonelik_katalog_durumu(integer) TO tekir_platform;
CREATE OR REPLACE FUNCTION abonelik_odeme_fiyatini_koru() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  f jsonb := NEW.fiyat_fotografi;
  k text;
  kayit_toplam numeric;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.fiyat_fotografi IS DISTINCT FROM OLD.fiyat_fotografi THEN
      RAISE EXCEPTION 'Odeme fiyat fotografi degistirilemez';
    END IF;
    IF OLD.fiyat_fotografi IS NOT NULL THEN
      IF ROW(NEW.id, NEW.tenant_id, NEW.ay_sayisi, NEW.matrah, NEW.kdv) IS DISTINCT FROM ROW(OLD.id, OLD.tenant_id, OLD.ay_sayisi, OLD.matrah, OLD.kdv) THEN
        RAISE EXCEPTION 'Fotografli odeme tutari veya kimligi degistirilemez';
      END IF;
      IF TG_TABLE_NAME = 'abonelik_odeme_denemeleri' THEN
        IF ROW(NEW.plan_kodu, NEW.toplam) IS DISTINCT FROM ROW(OLD.plan_kodu, OLD.toplam) THEN RAISE EXCEPTION 'Fotografli odeme tutari veya plani degistirilemez'; END IF;
      ELSE
        IF NEW.tutar IS DISTINCT FROM OLD.tutar THEN RAISE EXCEPTION 'Fotografli odeme tutari degistirilemez'; END IF;
      END IF;
    END IF;
  END IF;
  -- Geçiş öncesi girişimler ve elle ödemeler eski davranışla tamamlanabilir.
  IF f IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(f) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Gecersiz odeme fiyat fotografi'; END IF;
  IF NOT (f ?& ARRAY['semaSurumu','kaynak','planKodu','planAdi','paraBirimi','kdvOrani','aySayisi','matrah','kdv','toplam'])
    OR NOT COALESCE((
      (f->'semaSurumu' = '1'::jsonb AND f->>'kaynak' = 'eski_sabit' AND (SELECT count(*) FROM jsonb_object_keys(f)) = 10)
      OR (f->'semaSurumu' = '2'::jsonb AND f->>'kaynak' = 'eski_plan_gecisi' AND (SELECT count(*) FROM jsonb_object_keys(f)) = 11
        AND jsonb_typeof(f->'paketSurumId') = 'string' AND (f->>'paketSurumId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$')
    ),false)
    OR f->>'paraBirimi' IS DISTINCT FROM 'TRY'
    OR jsonb_typeof(f->'planKodu') IS DISTINCT FROM 'string' OR length(f->>'planKodu') NOT BETWEEN 1 AND 40
    OR jsonb_typeof(f->'planAdi') IS DISTINCT FROM 'string' OR length(f->>'planAdi') NOT BETWEEN 1 AND 100
    OR jsonb_typeof(f->'kdvOrani') IS DISTINCT FROM 'string'
    OR (f->>'kdvOrani') !~ '^(0|[1-9][0-9]{0,2})(\.[0-9]{1,2})?$'
    OR jsonb_typeof(f->'aySayisi') IS DISTINCT FROM 'number'
    OR f->'aySayisi' NOT IN ('1'::jsonb,'3'::jsonb,'6'::jsonb,'12'::jsonb) THEN
    RAISE EXCEPTION 'Gecersiz odeme fiyat fotografi';
  END IF;
  FOREACH k IN ARRAY ARRAY['matrah','kdv','toplam'] LOOP
    IF jsonb_typeof(f->k) IS DISTINCT FROM 'string' OR (f->>k) !~ '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' THEN
      RAISE EXCEPTION 'Gecersiz odeme fiyat tutari';
    END IF;
  END LOOP;
  IF TG_TABLE_NAME = 'abonelik_odeme_denemeleri' THEN
    kayit_toplam := NEW.toplam;
    IF NEW.plan_kodu IS DISTINCT FROM f->>'planKodu' THEN RAISE EXCEPTION 'Fotograf plani odemeyle uyusmuyor'; END IF;
  ELSE
    kayit_toplam := NEW.tutar;
  END IF;
  IF NEW.ay_sayisi IS DISTINCT FROM (f->>'aySayisi')::integer
    OR NEW.matrah IS DISTINCT FROM (f->>'matrah')::numeric
    OR NEW.kdv IS DISTINCT FROM (f->>'kdv')::numeric
    OR kayit_toplam IS DISTINCT FROM (f->>'toplam')::numeric
    OR (f->>'kdvOrani')::numeric > 100
    OR round((f->>'matrah')::numeric * (f->>'kdvOrani')::numeric / 100, 2) <> (f->>'kdv')::numeric
    OR (f->>'matrah')::numeric + (f->>'kdv')::numeric <> (f->>'toplam')::numeric THEN
    RAISE EXCEPTION 'Fiyat fotografi odeme tutarlariyla uyusmuyor';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
