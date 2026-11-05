BEGIN;
ALTER TABLE platform_paketler
  ADD COLUMN satis_acik boolean NOT NULL DEFAULT false,
  ADD COLUMN satis_surum_id uuid REFERENCES platform_paket_surumleri(id) ON DELETE RESTRICT,
  ADD COLUMN satis_kilit_surumu integer NOT NULL DEFAULT 1 CHECK(satis_kilit_surumu>0),
  ADD CHECK(NOT satis_acik OR satis_surum_id IS NOT NULL);

CREATE TABLE platform_paket_satis_gecmisi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paket_id uuid NOT NULL REFERENCES platform_paketler(id) ON DELETE RESTRICT,
  kullanici_id uuid NOT NULL REFERENCES platform_kullanicilari(id) ON DELETE RESTRICT,
  kilit_surumu integer NOT NULL,
  neden text NOT NULL CHECK(length(btrim(neden)) BETWEEN 5 AND 1000),
  onceki jsonb NOT NULL, yeni jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(paket_id,kilit_surumu)
);
ALTER TABLE platform_paket_satis_gecmisi ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_paket_satis_gecmisi FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_erisim ON platform_paket_satis_gecmisi TO tekir_platform USING(true);
REVOKE ALL ON platform_paket_satis_gecmisi FROM PUBLIC,tekir_app,tekir_platform;
GRANT SELECT ON platform_paket_satis_gecmisi TO tekir_platform;

CREATE FUNCTION platform_paket_satisini_koru() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE s platform_paket_surumleri;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.satis_acik OR NEW.satis_surum_id IS NOT NULL OR NEW.satis_kilit_surumu<>1 THEN RAISE EXCEPTION 'satis_ilk_durum'; END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-paket:'||NEW.id::text,0));
  IF ROW(NEW.id,NEW.kod,NEW.eski_plan_kodu,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.kod,OLD.eski_plan_kodu,OLD.created_at)
    OR NEW.satis_kilit_surumu<>OLD.satis_kilit_surumu+1 THEN RAISE EXCEPTION 'satis_kilit'; END IF;
  IF NEW.satis_surum_id IS NOT NULL THEN
    SELECT * INTO s FROM platform_paket_surumleri WHERE id=NEW.satis_surum_id AND paket_id=NEW.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'satis_surum_yok'; END IF;
    IF NEW.satis_acik AND (s.durum<>'yayinlandi' OR s.fiyatlandirma IS NULL OR s.kapsam_sozlesmesi IS NULL) THEN RAISE EXCEPTION 'satis_hazir_degil'; END IF;
    IF NEW.satis_acik AND (s.fiyatlandirma->>'gecerlilikTarihi')::date>(clock_timestamp() AT TIME ZONE 'Europe/Istanbul')::date THEN RAISE EXCEPTION 'satis_fiyat_tarihi'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_paket_satisini_koru BEFORE INSERT OR UPDATE ON platform_paketler FOR EACH ROW EXECUTE FUNCTION platform_paket_satisini_koru();

CREATE FUNCTION platform_satis_surumu_arsivini_koru() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-paket:'||NEW.paket_id::text,0));
  -- REPEATABLE READ eski satış durumuyla arşivleyemez; değişen satır serialization hatası üretir.
  PERFORM 1 FROM platform_paketler WHERE id=NEW.paket_id FOR UPDATE;
  IF NEW.durum<>'yayinlandi' AND EXISTS(SELECT 1 FROM platform_paketler WHERE id=NEW.paket_id AND satis_acik AND satis_surum_id=NEW.id) THEN
    RAISE EXCEPTION 'satis_once_durdur';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_satis_surumu_arsivini_koru BEFORE UPDATE ON platform_paket_surumleri FOR EACH ROW EXECUTE FUNCTION platform_satis_surumu_arsivini_koru();

CREATE FUNCTION platform_paket_satis_degistir(p_kullanici uuid,p_paket uuid,p_acik boolean,p_surum uuid,p_kilit integer,p_surum_kilit integer,p_neden text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $$
DECLARE p platform_paketler; s platform_paket_surumleri; onceki jsonb; yeni jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-kullanici-yetki',0));
  IF NOT EXISTS(SELECT 1 FROM platform_kullanicilari WHERE id=p_kullanici AND aktif AND rol='yonetici' AND davet_turu IS NULL) THEN RAISE EXCEPTION 'satis_yetki'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('platform-paket:'||p_paket::text,0));
  SELECT * INTO p FROM platform_paketler WHERE id=p_paket FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'satis_paket_yok'; END IF;
  IF p.satis_kilit_surumu IS DISTINCT FROM p_kilit THEN RAISE EXCEPTION 'satis_kilit'; END IF;
  IF p_acik IS NULL OR p_neden IS NULL OR length(btrim(p_neden)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'satis_girdi'; END IF;
  IF p_acik THEN
    SELECT * INTO s FROM platform_paket_surumleri WHERE id=p_surum AND paket_id=p_paket FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'satis_surum_yok'; END IF;
    IF s.kilit_surumu IS DISTINCT FROM p_surum_kilit THEN RAISE EXCEPTION 'satis_kilit'; END IF;
  ELSE
    IF p_surum IS NOT NULL OR p_surum_kilit IS NOT NULL THEN RAISE EXCEPTION 'satis_girdi'; END IF;
    p_surum:=p.satis_surum_id;
    SELECT * INTO s FROM platform_paket_surumleri WHERE id=p_surum;
  END IF;
  -- Tekrarlanan mevcut durum yeni geçmiş veya revizyon üretmez.
  IF ROW(p.satis_acik,p.satis_surum_id) IS NOT DISTINCT FROM ROW(p_acik,p_surum) THEN
    RETURN jsonb_build_object('tekrar',true,'kilitSurumu',p.satis_kilit_surumu);
  END IF;
  onceki:=jsonb_build_object('acik',p.satis_acik,'surumId',p.satis_surum_id);
  UPDATE platform_paketler SET satis_acik=p_acik,satis_surum_id=p_surum,satis_kilit_surumu=satis_kilit_surumu+1 WHERE id=p_paket RETURNING * INTO p;
  yeni:=jsonb_build_object('acik',p.satis_acik,'surumId',p.satis_surum_id,'surumNo',s.surum_no,'ad',s.ad,'fiyatlandirma',s.fiyatlandirma,'kapsamSozlesmesi',s.kapsam_sozlesmesi);
  INSERT INTO platform_paket_satis_gecmisi(paket_id,kullanici_id,kilit_surumu,neden,onceki,yeni) VALUES(p.id,p_kullanici,p.satis_kilit_surumu,btrim(p_neden),onceki,yeni);
  RETURN jsonb_build_object('tekrar',false,'kilitSurumu',p.satis_kilit_surumu);
END $$;
REVOKE ALL ON FUNCTION platform_paket_satis_degistir(uuid,uuid,boolean,uuid,integer,integer,text) FROM PUBLIC,tekir_app;
GRANT EXECUTE ON FUNCTION platform_paket_satis_degistir(uuid,uuid,boolean,uuid,integer,integer,text) TO tekir_platform;
COMMIT;
