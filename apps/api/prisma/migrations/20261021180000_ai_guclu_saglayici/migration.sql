-- AI-81: isteğe bağlı güçlü sağlayıcı ("Derin analiz"); ayrı anahtar, fiyat ve yurt dışı onayı.
ALTER TABLE tenant_ai_ayarlari
  ADD COLUMN guclu_saglayici TEXT,
  ADD COLUMN guclu_api_key TEXT,
  ADD COLUMN guclu_base_url TEXT,
  ADD COLUMN guclu_giris_token_milyon_usd DECIMAL(12,6),
  ADD COLUMN guclu_cikis_token_milyon_usd DECIMAL(12,6),
  ADD COLUMN guclu_onay_at TIMESTAMP(3),
  ADD COLUMN guclu_onay_user_id UUID,
  ADD COLUMN guclu_onay_saglayici TEXT,
  ADD COLUMN guclu_onay_model TEXT,
  ADD COLUMN guclu_onay_politika TEXT;
