-- PLT-27 devamı: tekrar korumasız eski elle ödeme işlevi kaldırılır.
-- 20261031150000_elle_odeme_tekrar_korumasi onu yalnız aynı veritabanını kullanan eski
-- pilot sürümü (gibliste-20261031) için bırakmıştı; pilot 2026-10-31'de platform-p0-20261031'e
-- (8 parametreli işlevi çağıran sürüm) geçti. Bu göçten sonra o eski sürüme geri dönülürse elle
-- ödeme kaydı çalışmaz; geri dönüş noktası platform-p0-20261031'dir.
DROP FUNCTION IF EXISTS platform_odeme_kaydet(uuid, integer, numeric, text, uuid, text);
