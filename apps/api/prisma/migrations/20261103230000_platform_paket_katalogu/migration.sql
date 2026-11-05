BEGIN;
CREATE TABLE platform_paketler (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kod varchar(40) NOT NULL UNIQUE CHECK (kod ~ '^[a-z][a-z0-9_]{1,39}$' AND kod <> 'v1'),
  eski_plan_kodu text UNIQUE,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE platform_paket_surumleri (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paket_id uuid NOT NULL REFERENCES platform_paketler(id) ON DELETE RESTRICT,
  surum_no integer NOT NULL CHECK (surum_no > 0),
  kilit_surumu integer NOT NULL DEFAULT 1 CHECK (kilit_surumu > 0),
  durum text NOT NULL DEFAULT 'taslak' CHECK (durum IN ('taslak','yayinlandi','arsiv')),
  ad varchar(100) NOT NULL CHECK (length(btrim(ad)) > 0),
  aciklama varchar(2000) NOT NULL DEFAULT '',
  ozellikler jsonb NOT NULL DEFAULT '[]',
  siralama integer NOT NULL DEFAULT 0 CHECK (siralama BETWEEN 0 AND 10000),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  yayinlandi_at timestamp(3), arsivlendi_at timestamp(3),
  UNIQUE (paket_id, surum_no),
  CHECK (jsonb_typeof(ozellikler) = 'array' AND jsonb_array_length(ozellikler) <= 30),
  CHECK ((durum = 'taslak' AND yayinlandi_at IS NULL AND arsivlendi_at IS NULL)
    OR (durum = 'yayinlandi' AND yayinlandi_at IS NOT NULL AND arsivlendi_at IS NULL AND jsonb_array_length(ozellikler) > 0)
    OR (durum = 'arsiv' AND yayinlandi_at IS NOT NULL AND arsivlendi_at IS NOT NULL))
);
CREATE UNIQUE INDEX platform_paket_tek_taslak ON platform_paket_surumleri(paket_id) WHERE durum = 'taslak';
-- Tanım aktarımıdır: fiyat, kota, abonelik veya ödeme kayıtlarını değiştirmez.
INSERT INTO platform_paketler(kod, eski_plan_kodu) VALUES ('baslangic','baslangic'), ('profesyonel','profesyonel'), ('kurumsal','kurumsal');
INSERT INTO platform_paket_surumleri(paket_id, surum_no, durum, ad, aciklama, ozellikler, siralama, yayinlandi_at)
SELECT p.id, 1, 'yayinlandi', s.ad, s.aciklama, s.ozellikler::jsonb, s.siralama, CURRENT_TIMESTAMP
FROM platform_paketler p JOIN (VALUES
  ('baslangic', 'Başlangıç', 'Küçük ekipler için temel finans ve stok yönetimi.', '["Cari, fatura ve stok","Kasa ve banka","Temel raporlar"]', 10),
  ('profesyonel', 'Profesyonel', 'Büyüyen işletmeler için geniş limitler ve entegrasyonlar.', '["Başlangıç planındaki her şey","e-Belge ve banka bağlantıları","Pazaryeri ve POS","Gelişmiş raporlar"]', 20),
  ('kurumsal', 'Kurumsal', 'Yüksek hacimli ekipler için limitsiz kullanım.', '["Profesyonel planındaki her şey","Limitsiz kayıt ve kullanıcı","Öncelikli destek"]', 30)
) AS s(kod, ad, aciklama, ozellikler, siralama) ON s.kod = p.kod;

CREATE FUNCTION platform_paket_surumu_koru() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
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
CREATE TRIGGER platform_paket_surumu_koru BEFORE INSERT OR UPDATE OR DELETE ON platform_paket_surumleri FOR EACH ROW EXECUTE FUNCTION platform_paket_surumu_koru();

REVOKE ALL ON platform_paketler, platform_paket_surumleri FROM PUBLIC, tekir_app, tekir_platform;
GRANT SELECT, INSERT ON platform_paketler TO tekir_platform;
GRANT SELECT, INSERT, UPDATE ON platform_paket_surumleri TO tekir_platform;
ALTER TABLE platform_paketler ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_paketler FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_paket_surumleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_paket_surumleri FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_erisim ON platform_paketler TO tekir_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_erisim ON platform_paket_surumleri TO tekir_platform USING (true) WITH CHECK (true);
COMMIT;
