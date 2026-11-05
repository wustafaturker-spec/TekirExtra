BEGIN;
ALTER TABLE platform_paket_surumleri ADD COLUMN deneme_gun_sayisi integer NOT NULL DEFAULT 0;
ALTER TABLE platform_paket_surumleri ADD CONSTRAINT platform_paket_deneme_gun_sayisi_check CHECK (deneme_gun_sayisi BETWEEN 0 AND 365);

CREATE OR REPLACE FUNCTION platform_paket_surumu_koru() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.deneme_gun_sayisi NOT BETWEEN 0 AND 365 THEN RAISE EXCEPTION 'Gecersiz deneme gun sayisi'; END IF;
  IF TG_OP='UPDATE' AND OLD.durum<>'taslak' AND NEW.deneme_gun_sayisi IS DISTINCT FROM OLD.deneme_gun_sayisi THEN RAISE EXCEPTION 'Yayinlanmis surum degistirilemez'; END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Paket surumu fiziksel olarak silinemez'; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('platform-paket:' || NEW.paket_id::text, 0));
    IF NEW.durum <> 'taslak' OR NEW.kilit_surumu <> 1 OR NEW.surum_no <> (SELECT COALESCE(max(surum_no),0) + 1 FROM platform_paket_surumleri WHERE paket_id = NEW.paket_id) THEN
      RAISE EXCEPTION 'Yeni paket surumu siradaki taslak olmali';
    END IF;
  ELSE
    IF ROW(NEW.id, NEW.paket_id, NEW.surum_no, NEW.created_at) IS DISTINCT FROM ROW(OLD.id, OLD.paket_id, OLD.surum_no, OLD.created_at)
      OR NEW.kilit_surumu <> OLD.kilit_surumu + 1 THEN RAISE EXCEPTION 'Paket surumu kimligi veya kilidi degistirilemez'; END IF;
    IF OLD.durum <> 'taslak' AND NOT (OLD.durum = 'yayinlandi' AND NEW.durum = 'arsiv'
      AND ROW(NEW.ad,NEW.aciklama,NEW.ozellikler,NEW.siralama,NEW.yayinlandi_at) IS NOT DISTINCT FROM ROW(OLD.ad,OLD.aciklama,OLD.ozellikler,OLD.siralama,OLD.yayinlandi_at)) THEN
      RAISE EXCEPTION 'Yayinlanmis paket icerigi degistirilemez';
    END IF;
    IF OLD.durum = 'taslak' AND NEW.durum NOT IN ('taslak','yayinlandi') THEN RAISE EXCEPTION 'Taslak yalniz yayinlanabilir'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.ozellikler) x WHERE jsonb_typeof(x) <> 'string' OR length(btrim(x #>> '{}')) NOT BETWEEN 1 AND 200) THEN
    RAISE EXCEPTION 'Gecersiz paket ozelligi';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION abonelik_acik_satis_deneme_gunleri()
RETURNS TABLE(surum_id uuid, gun_sayisi integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public SET row_security=off AS $$
  SELECT s.id,s.deneme_gun_sayisi
  FROM platform_paketler p JOIN platform_paket_surumleri s ON s.id=p.satis_surum_id AND s.paket_id=p.id
  WHERE p.satis_acik AND s.durum='yayinlandi'
    AND s.fiyatlandirma IS NOT NULL AND s.kapsam_sozlesmesi IS NOT NULL
    AND (s.fiyatlandirma->>'gecerlilikTarihi')::date <= (clock_timestamp() AT TIME ZONE 'Europe/Istanbul')::date
$$;
REVOKE ALL ON FUNCTION abonelik_acik_satis_deneme_gunleri() FROM PUBLIC,tekir_platform;
GRANT EXECUTE ON FUNCTION abonelik_acik_satis_deneme_gunleri() TO tekir_app;
COMMIT;
