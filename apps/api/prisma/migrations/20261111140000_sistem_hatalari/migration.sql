-- PLT-118…122: uygulama hataları. API'nin 500 yanıtları ve tarayıcı hataları parmak
-- izine göre tek satırda birikir. Kiracı verisi taşımaz: mesaj maskelenir, istek
-- gövdesi saklanmaz; firma kimlikleri yalnız etki ölçüsü için (en çok 50).
CREATE TABLE sistem_hatalari (
  parmak_izi VARCHAR(64) PRIMARY KEY,
  kaynak VARCHAR(10) NOT NULL CHECK (kaynak IN ('api', 'web')),
  ad VARCHAR(200) NOT NULL,
  mesaj VARCHAR(1000) NOT NULL,
  yigin VARCHAR(4000),
  konum VARCHAR(300) NOT NULL,
  sayi BIGINT NOT NULL DEFAULT 1,
  saat_sayi INTEGER NOT NULL DEFAULT 1,
  saat_baslangic TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ilk_gorulme TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  son_gorulme TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  son_istek_id VARCHAR(100),
  surum VARCHAR(120),
  firmalar UUID[] NOT NULL DEFAULT '{}',
  cozuldu_at TIMESTAMP(3)
);
CREATE INDEX sistem_hatalari_son_gorulme_idx ON sistem_hatalari (son_gorulme);

GRANT SELECT, INSERT, UPDATE, DELETE ON sistem_hatalari TO tekir_app;
GRANT SELECT ON sistem_hatalari TO tekir_platform;
