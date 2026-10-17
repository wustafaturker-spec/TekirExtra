-- pg_restore boş search_path ile şemayı kurar. SQL fonksiyonu ve sözlüğü
-- açık şemayla çöz: generated kolonlar geri yükleme sırasında da oluşabilsin.
-- Eski migration checksum'ları ve mevcut STORED değerlerin anlamı korunur.
CREATE OR REPLACE FUNCTION public.tekir_arama_normal(metin text)
RETURNS text AS $$
  SELECT public.unaccent('public.unaccent'::pg_catalog.regdictionary,
                         pg_catalog.lower(coalesce(metin, '')));
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE CALLED ON NULL INPUT;
