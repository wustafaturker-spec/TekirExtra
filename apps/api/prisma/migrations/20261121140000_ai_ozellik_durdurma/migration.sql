-- AI-109: yapay zekâ özellikleri için platform acil durdurması ve firma düzeyinde kapatma.

-- Platform geneli: satır yoksa özellik açıktır. Yalnız platform ekibi yazar; her kiracı
-- süreci (api, worker, telegram) okur — veri kiracıya ait değildir, firma bilgisi taşımaz.
CREATE TABLE platform_ai_ozellik_durumlari (
  ozellik TEXT PRIMARY KEY CHECK (ozellik IN ('asistan', 'asistan_telegram', 'arka_plan_gorevi', 'sabah_hazirlik', 'teklif_otomasyonu', 'ocr', 'mcp')),
  durduruldu BOOLEAN NOT NULL DEFAULT false,
  neden TEXT CHECK (neden IS NULL OR length(neden) <= 500),
  guncelleyen_id UUID REFERENCES platform_kullanicilari(id),
  guncellendi_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE platform_ai_ozellik_durumlari ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_ai_ozellik_durumlari FORCE ROW LEVEL SECURITY;
CREATE POLICY herkes_okur ON platform_ai_ozellik_durumlari FOR SELECT TO tekir_app USING (true);
CREATE POLICY platform_tam ON platform_ai_ozellik_durumlari TO tekir_platform USING (true) WITH CHECK (true);
GRANT SELECT ON platform_ai_ozellik_durumlari TO tekir_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_ai_ozellik_durumlari TO tekir_platform;

-- Firma düzeyi: kapatılan özellik anahtarları (genel `ozellikler_etkin` şalterinin yanında).
ALTER TABLE tenant_ai_ayarlari ADD COLUMN kapali_ozellikler TEXT[] NOT NULL DEFAULT '{}';
