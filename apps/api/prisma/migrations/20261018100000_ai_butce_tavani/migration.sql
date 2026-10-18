-- AI-28…31: aylık yapay zekâ bütçesi uygulanır; platform anahtarıyla çalışan
-- kiracılar için platform ekibi aylık tavan koyar.

-- AI-30: token sayısı dönmeyen çağrının maliyeti metin uzunluğundan tahmin edilir.
ALTER TABLE ai_cagri_izleri ADD COLUMN maliyet_tahmini BOOLEAN NOT NULL DEFAULT false;

-- AI-31: kiracı başı aylık tavan (USD). Satır yoksa ortam varsayılanı
-- (AI_PLATFORM_AYLIK_TAVAN_USD) geçerlidir. Yalnız platform ekibi yazar;
-- kiracı yalnız kendi satırını okur.
CREATE TABLE platform_ai_tavanlari (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  aylik_tavan_usd DECIMAL(12, 2) NOT NULL CHECK (aylik_tavan_usd >= 0),
  guncelleyen_id UUID REFERENCES platform_kullanicilari(id),
  guncellendi_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE platform_ai_tavanlari ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_ai_tavanlari FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform_ai_tavanlari TO tekir_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY platform_tam ON platform_ai_tavanlari TO tekir_platform
  USING (true) WITH CHECK (true);
GRANT SELECT ON platform_ai_tavanlari TO tekir_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_ai_tavanlari TO tekir_platform;

-- Platform ekranı: kiracı, kullandığı anahtar, kiracı bütçesi, bu ayki maliyet
-- ve tavan. Platform rolü kiracı tablolarını okuyamaz; yalnız bu özeti görür.
CREATE FUNCTION platform_ai_kiraci_ozeti(p_ay_baslangici timestamp)
RETURNS TABLE (
  tenant_id uuid, unvan text, saglayici text, kendi_anahtari boolean,
  kiraci_butcesi_usd numeric, bu_ay_usd numeric, tahmini_cagri bigint, tavan_usd numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT t.id, t.unvan, COALESCE(a.saglayici, 'varsayilan'), a.api_key IS NOT NULL AND a.api_key <> '',
         a.aylik_maliyet_butcesi_usd,
         COALESCE((SELECT sum(i.maliyet_usd) FROM ai_cagri_izleri i WHERE i.tenant_id = t.id AND i.created_at >= p_ay_baslangici), 0),
         (SELECT count(*) FROM ai_cagri_izleri i WHERE i.tenant_id = t.id AND i.created_at >= p_ay_baslangici AND i.maliyet_tahmini),
         p.aylik_tavan_usd
  FROM tenants t
  LEFT JOIN tenant_ai_ayarlari a ON a.tenant_id = t.id
  LEFT JOIN platform_ai_tavanlari p ON p.tenant_id = t.id
  ORDER BY t.unvan;
$$;
REVOKE ALL ON FUNCTION platform_ai_kiraci_ozeti(timestamp) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_ai_kiraci_ozeti(timestamp) TO tekir_platform;
