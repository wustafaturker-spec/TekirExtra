-- Kiracılar arası yabancı anahtar bağını engeller (IDOR taraması, docs/GUVENLIK-IDOR-TARAMASI.md).
--
-- RLS başka kiracının satırını okumayı engeller ama yabancı anahtar denetimi RLS'ye tabi
-- değildir: servis kimliği kendisi denetlemezse başka kiracının kaydına bağ kurulabilir.
-- Tetikleyici üst kaydın aynı kiracıda olmasını ister; aykırılıkta yabancı anahtar hatası
-- verir, böylece "başka kiracıda" ile "hiç yok" istemciden ayırt edilemez.
--
-- SECURITY DEFINER + row_security=off: sonuç o anki kiracı bağlamına ve role bağlı olmaz.
-- AFTER: aynı ifadede eklenen üst kayıt ve kendine bağlı satırlar görünür olur.
-- Yeni yabancı anahtarlar için test/rls-kapsama.kabul.test.ts düşer.
SET lock_timeout = '15s';

CREATE OR REPLACE FUNCTION kiraci_bag_denetle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE
  sutun text := TG_ARGV[0];
  ust_tablo text := TG_ARGV[1];
  ust_sutun text := TG_ARGV[2];
  uygun boolean;
BEGIN
  EXECUTE format('SELECT ($1).tenant_id IS NULL OR EXISTS (SELECT 1 FROM %2$I u WHERE u.%3$I = ($1).%1$I AND u.tenant_id = ($1).tenant_id)', sutun, ust_tablo, ust_sutun)
    INTO uygun USING NEW;
  IF NOT uygun THEN
    RAISE foreign_key_violation USING MESSAGE = format('%s.%s bağlı kaydı bulunamadı', TG_TABLE_NAME, sutun), CONSTRAINT = TG_NAME;
  END IF;
  RETURN NULL;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT k.conname, c.relname AS cocuk, a.attname AS sutun, p.relname AS ust, pa.attname AS ust_sutun
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class p ON p.oid = k.confrelid
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = k.confkey[1]
    WHERE k.contype = 'f' AND n.nspname = 'public' AND array_length(k.conkey, 1) = 1
      AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = k.conrelid AND x.attname = 'tenant_id' AND NOT x.attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = k.confrelid AND x.attname = 'tenant_id' AND NOT x.attisdropped)
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OF %I, tenant_id ON %I FOR EACH ROW WHEN (NEW.%I IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle(%L, %L, %L)',
      left('kbag_' || r.conname, 54) || '_' || left(md5(r.conname), 8), r.sutun, r.cocuk, r.sutun, r.sutun, r.ust, r.ust_sutun
    );
  END LOOP;
END $$;
