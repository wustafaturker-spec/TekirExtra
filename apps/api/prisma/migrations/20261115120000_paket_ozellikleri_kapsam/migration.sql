-- CNL-19/END: paket kapsamındaki plan özellikleri (`ozellikler`) DB tetikleyicisinde tanımsızdı;
-- özellik seçilen taslak "Gecersiz paket kapsam sozlesmesi" ile 500 veriyordu (2026-11-15).
-- Paylaşılan şemayla aynı kural: bilinen anahtarlar, yalnız boolean, gereken modül seçili.
-- Yalnız tetikleyici işlevini değiştirir; veri değişmez.
BEGIN;
CREATE OR REPLACE FUNCTION platform_paket_kapsamini_koru() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE k jsonb := NEW.kapsam_sozlesmesi; q jsonb; kod text; modul jsonb;
  kodlar text[] := ARRAY['satis','fatura','ebelge','cari','kasa_banka','masraf_gelir','satin_alma','stok','uretim','personel','demirbas_arac','projeler','butce_nakit','raporlar','mali_musavir','donem_kapatma','yapay_zeka'];
BEGIN
  IF TG_OP='UPDATE' AND OLD.durum<>'taslak' AND NEW.kapsam_sozlesmesi IS DISTINCT FROM OLD.kapsam_sozlesmesi THEN
    RAISE EXCEPTION 'Yayinlanmis paket kapsami degistirilemez';
  END IF;
  IF k IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(k) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Gecersiz paket kapsam sozlesmesi'; END IF;
  IF NOT (k ?& ARRAY['semaSurumu','moduller','kotalar']) OR (SELECT count(*) FROM jsonb_object_keys(k-'depolama'-'ozellikler'))<>3
    OR k->'semaSurumu' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(k->'moduller') IS DISTINCT FROM 'array'
    OR jsonb_typeof(k->'kotalar') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Gecersiz paket kapsam sozlesmesi'; END IF;
  IF jsonb_array_length(k->'moduller') NOT BETWEEN 1 AND cardinality(kodlar)
    OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(k->'moduller'))<>jsonb_array_length(k->'moduller') THEN
    RAISE EXCEPTION 'Gecersiz veya tekrarli paket modulleri';
  END IF;
  FOR modul IN SELECT value FROM jsonb_array_elements(k->'moduller') LOOP
    IF jsonb_typeof(modul) IS DISTINCT FROM 'string' OR NOT ((modul#>>'{}')=ANY(kodlar)) THEN RAISE EXCEPTION 'Gecersiz paket modulu'; END IF;
  END LOOP;
  IF (k->'moduller' ? 'fatura' AND NOT (k->'moduller' ? 'cari'))
    OR (k->'moduller' ? 'ebelge' AND NOT (k->'moduller' ? 'fatura'))
    OR (k->'moduller' ? 'uretim' AND NOT (k->'moduller' ? 'stok')) THEN RAISE EXCEPTION 'Paket modul bagimliligi eksik'; END IF;
  IF NOT (k->'kotalar' ?& ARRAY['kullanici','cari','stok','aylikFatura']) OR (SELECT count(*) FROM jsonb_object_keys(k->'kotalar'))<>4 THEN RAISE EXCEPTION 'Gecersiz paket kotalari'; END IF;
  FOREACH kod IN ARRAY ARRAY['kullanici','cari','stok','aylikFatura'] LOOP
    q := k->'kotalar'->kod;
    IF jsonb_typeof(q) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Gecersiz paket kotasi'; END IF;
    IF NOT (q ?& ARRAY['sinir','uyariYuzdesi']) OR (SELECT count(*) FROM jsonb_object_keys(q))<>2
      OR jsonb_typeof(q->'uyariYuzdesi') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Gecersiz kota esigi'; END IF;
    IF (q->>'uyariYuzdesi')::numeric NOT BETWEEN 1 AND 99 OR trunc((q->>'uyariYuzdesi')::numeric)<>(q->>'uyariYuzdesi')::numeric THEN RAISE EXCEPTION 'Gecersiz kota esigi'; END IF;
    IF q->'sinir'<>'null'::jsonb THEN
      IF jsonb_typeof(q->'sinir') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Gecersiz kota siniri'; END IF;
      IF (q->>'sinir')::numeric NOT BETWEEN 0 AND 2147483647 OR trunc((q->>'sinir')::numeric)<>(q->>'sinir')::numeric THEN RAISE EXCEPTION 'Gecersiz kota siniri'; END IF;
    END IF;
  END LOOP;
  IF k ? 'depolama' THEN
    q:=k->'depolama';
    IF jsonb_typeof(q) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Gecersiz depolama sozlesmesi'; END IF;
    IF NOT(q ?& ARRAY['sinirBayt','uyariYuzdesi']) OR (SELECT count(*) FROM jsonb_object_keys(q))<>2
      OR jsonb_typeof(q->'uyariYuzdesi') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Gecersiz depolama sozlesmesi'; END IF;
    IF (q->>'uyariYuzdesi')::numeric NOT BETWEEN 1 AND 99 OR trunc((q->>'uyariYuzdesi')::numeric)<>(q->>'uyariYuzdesi')::numeric THEN RAISE EXCEPTION 'Gecersiz depolama esigi'; END IF;
    IF q->'sinirBayt'<>'null'::jsonb THEN
      IF jsonb_typeof(q->'sinirBayt') IS DISTINCT FROM 'string' OR (q->>'sinirBayt') !~ '^(0|[1-9][0-9]{0,18})$' THEN RAISE EXCEPTION 'Gecersiz depolama siniri'; END IF;
      IF (q->>'sinirBayt')::numeric>9223372036854775807 THEN RAISE EXCEPTION 'Gecersiz depolama siniri'; END IF;
    END IF;
  END IF;
  IF k ? 'ozellikler' THEN
    q:=k->'ozellikler';
    IF jsonb_typeof(q) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Gecersiz paket ozellikleri'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_each(q) o WHERE o.key NOT IN ('telegramOzelBot','fiyatEndeksAnalizi') OR jsonb_typeof(o.value) IS DISTINCT FROM 'boolean') THEN
      RAISE EXCEPTION 'Gecersiz paket ozellikleri';
    END IF;
    IF (q->'telegramOzelBot'='true'::jsonb AND NOT (k->'moduller' ? 'yapay_zeka'))
      OR (q->'fiyatEndeksAnalizi'='true'::jsonb AND NOT (k->'moduller' ? 'raporlar')) THEN
      RAISE EXCEPTION 'Paket ozelligi icin modul eksik';
    END IF;
  END IF;
  RETURN NEW;
END $$;
COMMIT;
