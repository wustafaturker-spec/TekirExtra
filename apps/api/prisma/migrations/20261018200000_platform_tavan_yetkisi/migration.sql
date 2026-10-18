-- AI-52 (güvenlik kabulünün bulgusu): `ALTER DEFAULT PRIVILEGES` (RLS göçü) her yeni
-- tabloya tekir_app için SELECT/INSERT/UPDATE/DELETE verir; 20261018100000'deki
-- "GRANT SELECT" bu yüzden etkisizdi ve RLS politikasının USING koşulu yazmada da
-- geçtiği için uygulama rolü kendi kiracısının platform tavanını yazabiliyordu.
-- Tavanı yalnız platform ekibi (tekir_platform) yazar; uygulama rolü yalnız okur.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform_ai_tavanlari FROM tekir_app;
