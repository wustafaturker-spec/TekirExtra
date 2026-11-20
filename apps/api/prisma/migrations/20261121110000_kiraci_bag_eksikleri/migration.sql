-- SEC-17 / RLS kapsama açıkları (test/rls-kapsama.kabul.test.ts, 2026-11-21): sonradan eklenen
-- tablolarda FORCE RLS ve kiracılar arası yabancı anahtar tetikleyicisi eksikti. Veriye
-- dokunmaz: yalnız RLS'i tablo sahibine de uygular ve eksik tetikleyicileri ekler.
-- Tetikleyici adı ve gövdesi 20261103090000_kiraci_bag_denetimi ile aynı kuralla üretilir;
-- var olan tetikleyici yeniden oluşturulmaz (göç tekrar çalışsa da güvenli).
SET lock_timeout = '15s';

ALTER TABLE "sozlesme_belgeler" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sozlesme_belge_parcalar" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE r record; ad text;
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
      -- Bu sütunu kapsayan kiracı bağı tetikleyicisi yoksa.
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger g JOIN pg_proc f ON f.oid = g.tgfoid
        WHERE g.tgrelid = k.conrelid AND f.proname = 'kiraci_bag_denetle' AND NOT g.tgisinternal AND a.attnum = ANY (g.tgattr::int2[])
      )
  LOOP
    ad := left('kbag_' || r.conname, 54) || '_' || left(md5(r.conname), 8);
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = ad AND tgrelid = format('%I', r.cocuk)::regclass) THEN
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OF %I, tenant_id ON %I FOR EACH ROW WHEN (NEW.%I IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle(%L, %L, %L)',
        ad, r.sutun, r.cocuk, r.sutun, r.sutun, r.ust, r.ust_sutun
      );
      RAISE NOTICE 'Kiracı bağı tetikleyicisi eklendi: %.%', r.cocuk, r.sutun;
    END IF;
  END LOOP;
END $$;
