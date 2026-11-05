BEGIN;
-- Kaynak yazıları ile başlangıç fotoğrafı arasında boşluk bırakma.
LOCK TABLE tenants, tenant_abonelikleri, abonelik_odemeleri IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE platform_buyume_ayari (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  baslangic timestamp(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')
);
INSERT INTO platform_buyume_ayari(id) VALUES (1);
-- Kaynak satır silinse de yalnız sayısal yaşam döngüsü geçmişi kalır.
CREATE TABLE platform_firma_yasam_olaylari (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  olay_at timestamp(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),
  tip varchar(20) NOT NULL CHECK (tip IN ('baslangic','kayit','abonelik','silme')),
  mevcut boolean NOT NULL,
  plan_kodu text NOT NULL,
  durum text NOT NULL,
  deneme_basladi boolean NOT NULL DEFAULT false,
  iptal_basladi boolean NOT NULL DEFAULT false
);
CREATE INDEX platform_firma_yasam_tenant_zaman_idx ON platform_firma_yasam_olaylari(tenant_id, olay_at DESC, id DESC);
CREATE INDEX platform_firma_yasam_zaman_idx ON platform_firma_yasam_olaylari(olay_at);
CREATE TABLE platform_buyume_odemeleri (
  odeme_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  sira bigint NOT NULL DEFAULT nextval('platform_firma_yasam_olaylari_id_seq'),
  olay_at timestamp(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')
);
CREATE INDEX platform_buyume_odeme_tenant_zaman_idx ON platform_buyume_odemeleri(tenant_id, olay_at);
INSERT INTO platform_firma_yasam_olaylari(tenant_id, olay_at, tip, mevcut, plan_kodu, durum)
  SELECT t.id, b.baslangic, 'baslangic', true, COALESCE(a.plan_kodu,'v1'), COALESCE(a.durum::text,'aktif')
  FROM tenants t CROSS JOIN platform_buyume_ayari b LEFT JOIN tenant_abonelikleri a ON a.tenant_id = t.id;

REVOKE ALL ON platform_buyume_ayari, platform_firma_yasam_olaylari, platform_buyume_odemeleri FROM PUBLIC, tekir_app, tekir_platform;
REVOKE ALL ON SEQUENCE platform_firma_yasam_olaylari_id_seq FROM PUBLIC, tekir_app, tekir_platform;
ALTER TABLE platform_buyume_ayari ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_buyume_ayari FORCE ROW LEVEL SECURITY;
CREATE POLICY kapali ON platform_buyume_ayari USING (false) WITH CHECK (false);
ALTER TABLE platform_firma_yasam_olaylari ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_firma_yasam_olaylari FORCE ROW LEVEL SECURITY;
CREATE POLICY kapali ON platform_firma_yasam_olaylari USING (false) WITH CHECK (false);
ALTER TABLE platform_buyume_odemeleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_buyume_odemeleri FORCE ROW LEVEL SECURITY;
CREATE POLICY kapali ON platform_buyume_odemeleri USING (false) WITH CHECK (false);

CREATE FUNCTION platform_buyume_yasam_kaydet() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE v_tenant uuid; v_mevcut boolean; v_plan text; v_durum text; v_tip text;
  v_deneme boolean := false; v_iptal boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'tenants' THEN
    IF TG_OP = 'INSERT' THEN v_tenant := NEW.id; v_tip := 'kayit';
    ELSE v_tenant := OLD.id; v_tip := 'silme'; END IF;
  ELSE
    IF TG_OP = 'UPDATE' AND NEW.plan_kodu = OLD.plan_kodu AND NEW.durum = OLD.durum THEN RETURN NEW; END IF;
    IF TG_OP = 'DELETE' THEN v_tenant := OLD.tenant_id;
    ELSE
      v_tenant := NEW.tenant_id;
      IF TG_OP = 'INSERT' THEN
        v_deneme := NEW.durum::text = 'deneme'; v_iptal := NEW.durum::text = 'iptal';
      ELSE
        v_deneme := NEW.durum::text = 'deneme' AND OLD.durum::text <> 'deneme';
        v_iptal := NEW.durum::text = 'iptal' AND OLD.durum::text <> 'iptal';
      END IF;
    END IF;
    v_tip := 'abonelik';
  END IF;
  SELECT EXISTS(SELECT 1 FROM tenants WHERE id = v_tenant) INTO v_mevcut;
  IF v_mevcut THEN
    SELECT a.plan_kodu, a.durum::text INTO v_plan, v_durum FROM tenant_abonelikleri a WHERE a.tenant_id = v_tenant;
  ELSE
    SELECT o.plan_kodu, o.durum INTO v_plan, v_durum FROM platform_firma_yasam_olaylari o
      WHERE o.tenant_id = v_tenant ORDER BY olay_at DESC, id DESC LIMIT 1;
  END IF;
  INSERT INTO platform_firma_yasam_olaylari(tenant_id, tip, mevcut, plan_kodu, durum, deneme_basladi, iptal_basladi)
    VALUES(v_tenant, v_tip, v_mevcut, COALESCE(v_plan,'v1'), COALESCE(v_durum,'aktif'), v_deneme, v_iptal);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER platform_buyume_firma AFTER INSERT OR DELETE ON tenants FOR EACH ROW EXECUTE FUNCTION platform_buyume_yasam_kaydet();
CREATE TRIGGER platform_buyume_abonelik AFTER INSERT OR UPDATE OR DELETE ON tenant_abonelikleri FOR EACH ROW EXECUTE FUNCTION platform_buyume_yasam_kaydet();

CREATE FUNCTION platform_buyume_odeme_kaydet() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
BEGIN
  -- Başarısız girişimler değil, pozitif tutarlı kaydedilmiş abonelik ödemesi.
  IF NEW.tutar > 0 THEN INSERT INTO platform_buyume_odemeleri(odeme_id, tenant_id) VALUES(NEW.id, NEW.tenant_id); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_buyume_odeme AFTER INSERT ON abonelik_odemeleri FOR EACH ROW EXECUTE FUNCTION platform_buyume_odeme_kaydet();

-- İç yardımcı: platform rolüne dahi doğrudan açılmaz; dış işlev aralığı doğrular.
CREATE FUNCTION platform_buyume_donemi(p_bas date, p_bit date, p_plan text, p_firma uuid, p_an timestamp)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  WITH sinir AS (
    SELECT (p_bas::timestamp AT TIME ZONE 'Europe/Istanbul' AT TIME ZONE 'UTC') AS bas,
      least(((p_bit + 1)::timestamp AT TIME ZONE 'Europe/Istanbul' AT TIME ZONE 'UTC'), p_an) AS son
  ), son AS MATERIALIZED (
    SELECT DISTINCT ON (o.tenant_id) o.* FROM platform_firma_yasam_olaylari o, sinir s
    WHERE o.olay_at < s.son AND (p_firma IS NULL OR o.tenant_id = p_firma)
    ORDER BY o.tenant_id, o.olay_at DESC, o.id DESC
  ), kapsam AS MATERIALIZED (SELECT * FROM son WHERE p_plan IS NULL OR plan_kodu = p_plan),
  ilk AS (
    SELECT DISTINCT ON (o.tenant_id) o.* FROM platform_firma_yasam_olaylari o JOIN kapsam k USING(tenant_id), sinir s
    WHERE o.olay_at < s.bas ORDER BY o.tenant_id, o.olay_at DESC, o.id DESC
  ), donem AS MATERIALIZED (
    SELECT o.* FROM platform_firma_yasam_olaylari o JOIN kapsam k USING(tenant_id), sinir s
    WHERE o.olay_at >= s.bas AND o.olay_at < s.son
  ), ilk_deneme AS (
    SELECT DISTINCT ON (o.tenant_id) o.tenant_id, o.olay_at, o.id FROM platform_firma_yasam_olaylari o JOIN kapsam k USING(tenant_id)
    WHERE o.deneme_basladi AND o.olay_at <= p_an
      AND EXISTS (SELECT 1 FROM platform_firma_yasam_olaylari r WHERE r.tenant_id = o.tenant_id AND r.tip = 'kayit' AND r.olay_at <= o.olay_at)
    ORDER BY o.tenant_id, o.olay_at, o.id
  ), kohort AS (
    SELECT d.*, d.olay_at + interval '14 days' <= p_an AS olgun,
      EXISTS (SELECT 1 FROM platform_buyume_odemeleri p WHERE p.tenant_id = d.tenant_id
        AND (p.olay_at, p.sira) >= (d.olay_at, d.id) AND p.olay_at < d.olay_at + interval '14 days' AND p.olay_at <= p_an) AS donustu
    FROM ilk_deneme d, sinir s WHERE d.olay_at >= s.bas AND d.olay_at < s.son
      AND NOT EXISTS (SELECT 1 FROM platform_buyume_odemeleri p WHERE p.tenant_id = d.tenant_id AND (p.olay_at, p.sira) < (d.olay_at, d.id))
  ), sayilar AS (
    SELECT (SELECT count(*) FROM ilk WHERE mevcut) AS baslangic,
      (SELECT count(*) FROM kapsam WHERE mevcut) AS bitis,
      (SELECT count(DISTINCT tenant_id) FROM donem WHERE tip = 'kayit') AS yeni,
      (SELECT count(DISTINCT tenant_id) FROM donem WHERE tip = 'silme') AS silinen,
      (SELECT count(DISTINCT tenant_id) FROM donem WHERE iptal_basladi) AS iptal,
      (SELECT count(*) FROM kohort) AS deneme,
      (SELECT count(*) FROM kohort WHERE olgun) AS olgun,
      (SELECT count(*) FROM kohort WHERE olgun AND donustu) AS donusen
  ), guven AS (SELECT s.bas >= a.baslangic AND s.bas < s.son AS tam FROM sinir s, platform_buyume_ayari a WHERE a.id = 1)
  SELECT jsonb_build_object('tam', g.tam,
    'baslangicFirma', CASE WHEN g.tam THEN n.baslangic END, 'bitisFirma', CASE WHEN g.tam THEN n.bitis END,
    'yeniFirma', CASE WHEN g.tam THEN n.yeni END, 'silinenFirma', CASE WHEN g.tam THEN n.silinen END,
    'netDegisim', CASE WHEN g.tam THEN n.bitis - n.baslangic END, 'iptalFirma', CASE WHEN g.tam THEN n.iptal END,
    'deneme', jsonb_build_object('baslayan', CASE WHEN g.tam THEN n.deneme END, 'olgunlasan', CASE WHEN g.tam THEN n.olgun END,
      'donusen', CASE WHEN g.tam THEN n.donusen END, 'bekleyen', CASE WHEN g.tam THEN n.deneme - n.olgun END,
      'oran', CASE WHEN g.tam AND n.olgun > 0 THEN round(n.donusen * 100.0 / n.olgun, 1) END)) FROM sayilar n, guven g
$$;
CREATE FUNCTION platform_buyume_raporu(p_bas date, p_bit date, p_plan text, p_firma uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE v_an timestamp := statement_timestamp() AT TIME ZONE 'UTC'; v_baslangic timestamp; v_adet integer;
BEGIN
  v_adet := p_bit - p_bas + 1;
  IF p_bas IS NULL OR p_bit IS NULL OR v_adet < 1 OR v_adet > 93 OR p_bas - v_adet < date '0001-01-01'
    OR p_bit > (statement_timestamp() AT TIME ZONE 'Europe/Istanbul')::date OR length(p_plan) > 40 THEN
    RAISE EXCEPTION 'Gecersiz buyume raporu araligi';
  END IF;
  SELECT baslangic INTO STRICT v_baslangic FROM platform_buyume_ayari WHERE id = 1;
  RETURN jsonb_build_object('olcumBaslangici', to_char(v_baslangic, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'hesaplandiAt', to_char(v_an, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'pencereGun', 14,
    'donem', platform_buyume_donemi(p_bas, p_bit, p_plan, p_firma, v_an),
    'onceki', platform_buyume_donemi(p_bas - v_adet, p_bas - 1, p_plan, p_firma, v_an));
END $$;
REVOKE ALL ON FUNCTION platform_buyume_yasam_kaydet(), platform_buyume_odeme_kaydet(), platform_buyume_donemi(date,date,text,uuid,timestamp), platform_buyume_raporu(date,date,text,uuid) FROM PUBLIC, tekir_app, tekir_platform;
GRANT EXECUTE ON FUNCTION platform_buyume_raporu(date,date,text,uuid) TO tekir_platform;
COMMIT;
