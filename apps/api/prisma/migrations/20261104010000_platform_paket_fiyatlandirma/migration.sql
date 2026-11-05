BEGIN;
-- Eski yayınlara varsayımsal fiyat eklenmez; abonelik/ödeme kayıtları değişmez.
ALTER TABLE platform_paket_surumleri ADD COLUMN fiyatlandirma jsonb;

CREATE FUNCTION platform_paket_fiyatini_koru() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  f jsonb := NEW.fiyatlandirma;
  d jsonb;
  gun date;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.durum <> 'taslak' AND NEW.fiyatlandirma IS DISTINCT FROM OLD.fiyatlandirma THEN
    RAISE EXCEPTION 'Yayinlanmis paket fiyati degistirilemez';
  END IF;
  IF f IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(f) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Gecersiz paket fiyat sozlesmesi'; END IF;
  IF NOT (f ?& ARRAY['paraBirimi','vergiDahil','kdvOrani','donemler','gecerlilikTarihi'])
    OR (SELECT count(*) FROM jsonb_object_keys(f)) <> 5
    OR f->>'paraBirimi' IS DISTINCT FROM 'TRY'
    OR f->'vergiDahil' IS DISTINCT FROM 'false'::jsonb
    OR jsonb_typeof(f->'kdvOrani') IS DISTINCT FROM 'string'
    OR (f->>'kdvOrani') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$'
    OR jsonb_typeof(f->'gecerlilikTarihi') IS DISTINCT FROM 'string'
    OR (f->>'gecerlilikTarihi') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR jsonb_typeof(f->'donemler') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Gecersiz paket fiyat sozlesmesi';
  END IF;
  IF (f->>'kdvOrani')::numeric > 100 OR jsonb_array_length(f->'donemler') NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'Gecersiz paket fiyat orani veya donemleri';
  END IF;
  gun := (f->>'gecerlilikTarihi')::date;
  IF to_char(gun, 'YYYY-MM-DD') <> f->>'gecerlilikTarihi' THEN RAISE EXCEPTION 'Gecersiz fiyat gecerlilik tarihi'; END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(f->'donemler') LOOP
    IF jsonb_typeof(d) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Gecersiz paket fiyat donemi'; END IF;
    IF NOT (d ?& ARRAY['aySayisi','matrah']) OR (SELECT count(*) FROM jsonb_object_keys(d)) <> 2
      OR jsonb_typeof(d->'aySayisi') IS DISTINCT FROM 'number'
      OR d->'aySayisi' NOT IN ('1'::jsonb,'3'::jsonb,'6'::jsonb,'12'::jsonb)
      OR jsonb_typeof(d->'matrah') IS DISTINCT FROM 'string'
      OR (d->>'matrah') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'Gecersiz paket fiyat donemi';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value->'aySayisi') FROM jsonb_array_elements(f->'donemler')) <> jsonb_array_length(f->'donemler') THEN
    RAISE EXCEPTION 'Tekrarlanan paket fiyat donemi';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_paket_fiyatini_koru BEFORE INSERT OR UPDATE ON platform_paket_surumleri
  FOR EACH ROW EXECUTE FUNCTION platform_paket_fiyatini_koru();
COMMIT;
