-- PLT-109…117: yedek talep ve sonuç kayıtları. Yedeği ayrı `yedekleme` servisi alır; platform rolü yalnız talep yazar.
CREATE TABLE platform_yedekler (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tur VARCHAR(10) NOT NULL CHECK (tur IN ('otomatik', 'elle')),
  durum VARCHAR(12) NOT NULL DEFAULT 'bekliyor' CHECK (durum IN ('bekliyor', 'calisiyor', 'basarili', 'hatali', 'silindi')),
  gun DATE,
  neden VARCHAR(500),
  baslatan_id UUID REFERENCES platform_kullanicilari(id) ON DELETE SET NULL ON UPDATE CASCADE,
  talep_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  baslangic_at TIMESTAMP(3),
  bitis_at TIMESTAMP(3),
  klasor VARCHAR(80) UNIQUE,
  boyut_bayt BIGINT,
  veritabani_bayt BIGINT,
  dosya_bayt BIGINT,
  ozet VARCHAR(64),
  son_migration TEXT,
  uygulama_surumu TEXT,
  kunye JSONB,
  hata TEXT,
  korunuyor BOOLEAN NOT NULL DEFAULT false,
  silinecek BOOLEAN NOT NULL DEFAULT false,
  silindi_at TIMESTAMP(3),
  deneme_durum VARCHAR(12) CHECK (deneme_durum IN ('bekliyor', 'calisiyor', 'basarili', 'hatali')),
  deneme_talep_at TIMESTAMP(3),
  deneme_at TIMESTAMP(3),
  deneme_detay TEXT,
  CONSTRAINT platform_yedekler_otomatik_gun CHECK ((tur = 'otomatik') = (gun IS NOT NULL)),
  CONSTRAINT platform_yedekler_elle_neden CHECK (tur <> 'elle' OR neden IS NOT NULL)
);
-- Aynı anda tek yedek: elle talep çalışan yedek varken buradan döner.
CREATE UNIQUE INDEX platform_yedekler_tek_aktif ON platform_yedekler ((true)) WHERE durum IN ('bekliyor', 'calisiyor');
-- Gün başına tek otomatik yedek; başarısız deneme yenisine engel olmaz.
CREATE UNIQUE INDEX platform_yedekler_otomatik_gun_tek ON platform_yedekler (gun) WHERE tur = 'otomatik' AND durum <> 'hatali';
CREATE INDEX platform_yedekler_talep_idx ON platform_yedekler (talep_at DESC);

CREATE TABLE platform_yedek_ajan (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  son_nabiz_at TIMESTAMP(3) NOT NULL,
  disk_toplam_bayt BIGINT NOT NULL,
  disk_bos_bayt BIGINT NOT NULL,
  surum TEXT
);

REVOKE ALL ON platform_yedekler, platform_yedek_ajan FROM PUBLIC, tekir_app;
GRANT SELECT, INSERT ON platform_yedekler TO tekir_platform;
GRANT UPDATE (korunuyor, silinecek, deneme_durum, deneme_talep_at) ON platform_yedekler TO tekir_platform;
GRANT SELECT ON platform_yedek_ajan TO tekir_platform;

ALTER TABLE platform_yedekler ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_yedekler FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_erisim ON platform_yedekler TO tekir_platform USING (true) WITH CHECK (true);
ALTER TABLE platform_yedek_ajan ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_yedek_ajan FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_erisim ON platform_yedek_ajan TO tekir_platform USING (true) WITH CHECK (true);
