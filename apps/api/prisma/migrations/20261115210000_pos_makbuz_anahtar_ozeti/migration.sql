-- SEC-23: makbuz bağlantı anahtarı artık saklanmaz; sunucu sırrından türetilir.
-- Müşterilerin sakladığı eski bağlantılar için mevcut düz anahtarların özeti tutulur.
-- Düz anahtarlar bu göçte silinmez (geri alınamaz işlem; ayrı onayla temizlenecek).
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "makbuz_anahtar_ozeti" VARCHAR(64);
UPDATE "pos_tahsilatlari" SET "makbuz_anahtar_ozeti" = encode(sha256(convert_to("makbuz_anahtari", 'UTF8')), 'hex') WHERE "makbuz_anahtari" IS NOT NULL;
ALTER TABLE "pos_tahsilatlari" ALTER COLUMN "makbuz_anahtari" DROP NOT NULL;
