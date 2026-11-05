BEGIN;

-- Publicly selectable offers are projected from the current, administrator-approved
-- sale pointer. The returned conditions are the immutable subscription snapshot.
CREATE FUNCTION abonelik_acik_satis_bagi()
RETURNS TABLE (surum_id uuid, plan_kodu text, kosullar jsonb, paket_adi text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public SET row_security=off AS $$
  SELECT s.id, p.kod,
    jsonb_build_object(
      'semaSurumu',2,'kaynak','katalog_atamasi','planKodu',p.kod,'planAdi',s.ad,
      'limitler',jsonb_build_object(
        'kullanici',s.kapsam_sozlesmesi->'kotalar'->'kullanici'->'sinir',
        'cari',s.kapsam_sozlesmesi->'kotalar'->'cari'->'sinir',
        'stok',s.kapsam_sozlesmesi->'kotalar'->'stok'->'sinir',
        'aylikFatura',s.kapsam_sozlesmesi->'kotalar'->'aylikFatura'->'sinir'),
      'fiyatlandirma',s.fiyatlandirma-'gecerlilikTarihi','kapsamSozlesmesi',s.kapsam_sozlesmesi),
    s.ad
  FROM platform_paketler p JOIN platform_paket_surumleri s ON s.id=p.satis_surum_id AND s.paket_id=p.id
  WHERE p.satis_acik
    AND s.durum='yayinlandi' AND s.fiyatlandirma IS NOT NULL AND s.kapsam_sozlesmesi IS NOT NULL
    AND (s.fiyatlandirma->>'gecerlilikTarihi')::date <= (clock_timestamp() AT TIME ZONE 'Europe/Istanbul')::date
$$;
REVOKE ALL ON FUNCTION abonelik_acik_satis_bagi() FROM PUBLIC,tekir_platform;
GRANT EXECUTE ON FUNCTION abonelik_acik_satis_bagi() TO tekir_app;

CREATE OR REPLACE FUNCTION abonelik_paket_bagini_koru() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE sid uuid; k jsonb; acik_k jsonb;
BEGIN
  IF TG_OP='UPDATE' AND (CASE WHEN NEW.plan_kodu='v1' THEN 'profesyonel' ELSE NEW.plan_kodu END)
    IS NOT DISTINCT FROM (CASE WHEN OLD.plan_kodu='v1' THEN 'profesyonel' ELSE OLD.plan_kodu END) THEN
    IF ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(OLD.paket_surum_id,OLD.paket_kosullari) THEN
      IF NOT EXISTS (SELECT 1 FROM platform_paket_atamalari p CROSS JOIN LATERAL jsonb_array_elements(p.veri->'kayitlar') r
        WHERE p.uygulandi_at IS NOT NULL AND p.xmin::text=pg_current_xact_id()::text
          AND p.hedef_surum_id=NEW.paket_surum_id AND ((r->'abonelik')-'kota_surumu')=(to_jsonb(OLD)-'kota_surumu') AND r->'hedefKosullar'=NEW.paket_kosullari
          AND (to_jsonb(NEW)-'paket_surum_id'-'paket_kosullari'-'updated_at')=(to_jsonb(OLD)-'paket_surum_id'-'paket_kosullari'-'updated_at')) THEN
        RAISE EXCEPTION 'Abonelik paket bagi veya korunmus kosullari degistirilemez';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND OLD.paket_kosullari->'semaSurumu'='2'::jsonb THEN RAISE EXCEPTION 'Kapsamli abonelik plani kontrollu kapsam atamasiyla degistirilmeli'; END IF;
  SELECT surum_id,kosullar INTO sid,acik_k FROM abonelik_acik_satis_bagi()
    WHERE surum_id=NEW.paket_surum_id AND plan_kodu=NEW.plan_kodu;
  IF NEW.paket_surum_id IS NOT NULL OR NEW.paket_kosullari IS NOT NULL THEN
    IF ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(sid,acik_k) THEN
      RAISE EXCEPTION 'Gecersiz abonelik paket bagi';
    END IF;
    NEW.paket_surum_id:=sid; NEW.paket_kosullari:=acik_k; RETURN NEW;
  END IF;
  SELECT surum_id,kosullar INTO sid,k FROM abonelik_eski_paket_bagi(NEW.plan_kodu);
  IF TG_OP='UPDATE' AND ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(OLD.paket_surum_id,OLD.paket_kosullari)
    AND ROW(NEW.paket_surum_id,NEW.paket_kosullari) IS DISTINCT FROM ROW(sid,k) THEN RAISE EXCEPTION 'Gecersiz abonelik paket gecisi'; END IF;
  NEW.paket_surum_id:=sid; NEW.paket_kosullari:=k; RETURN NEW;
END $$;

COMMIT;
