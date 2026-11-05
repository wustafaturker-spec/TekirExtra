BEGIN;
-- Şema 2 katalog atamasının kaynağını da korur; eski fotoğraflar değişmez.
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
      OR (f->'semaSurumu' = '2'::jsonb AND f->>'kaynak' IN ('eski_plan_gecisi','katalog_atamasi') AND (SELECT count(*) FROM jsonb_object_keys(f)) = 11
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
