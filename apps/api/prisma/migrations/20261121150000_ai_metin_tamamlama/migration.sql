-- AI-115: metin alanında yapay zekâ tamamlama ve yeniden yazma.

-- Acil durdurma listesine yeni özellik anahtarı.
ALTER TABLE platform_ai_ozellik_durumlari DROP CONSTRAINT platform_ai_ozellik_durumlari_ozellik_check;
ALTER TABLE platform_ai_ozellik_durumlari ADD CONSTRAINT platform_ai_ozellik_durumlari_ozellik_check
  CHECK (ozellik IN ('asistan', 'asistan_telegram', 'arka_plan_gorevi', 'sabah_hazirlik', 'teklif_otomasyonu', 'ocr', 'mcp', 'metin_tamamlama'));

-- Kişisel tercih: kullanıcı kendi hesabından kapatabilir (varsayılan açık).
ALTER TABLE users ADD COLUMN ai_metin_tamamlama BOOLEAN NOT NULL DEFAULT true;
