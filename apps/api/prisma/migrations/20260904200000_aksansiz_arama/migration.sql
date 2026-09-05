-- Aksana duyarsız arama (ARA-01).
--
-- Prisma'nın `contains` + `mode: "insensitive"` koşulu Postgres ILIKE'a çevrilir;
-- ILIKE büyük/küçük harfi katlar ama aksanı katlamaz. Bu yüzden "sisli" araması
-- "Şişli Makina"yı, "cagri" araması "Çağrı Ünlü"yü bulamıyordu.
--
-- Çözüm: aranabilir alanları normalize eden STORED generated kolonlar. Değer
-- veritabanında üretilir, uygulama yalnız okur ve arama terimini aynı kuralla
-- normalize edip (packages/shared → metinNormalize) bu kolonda arar.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() STABLE'dır; generated kolon ve indeks IMMUTABLE ister.
-- Sarmalayıcı sözlüğü açıkça vererek çağrıyı deterministik hale getirir.
CREATE OR REPLACE FUNCTION tekir_arama_normal(metin text)
RETURNS text AS $$
  SELECT unaccent('unaccent', lower(coalesce(metin, '')));
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

COMMENT ON FUNCTION tekir_arama_normal(text) IS
  'Arama normalizasyonu: küçült + aksan katla. istemci tarafındaki metinNormalize ile aynı sonucu üretir (ş→s, ç→c, ğ→g, ü→u, ö→o, ı→i, İ→i).';

ALTER TABLE "cari_hesaplar" ADD COLUMN "arama_normal" TEXT
  GENERATED ALWAYS AS (
    tekir_arama_normal("unvan") || ' ' || tekir_arama_normal("kod") || ' ' ||
    tekir_arama_normal("vkn_tckn") || ' ' || tekir_arama_normal("telefon")
  ) STORED;

ALTER TABLE "stok_kartlari" ADD COLUMN "arama_normal" TEXT
  GENERATED ALWAYS AS (
    tekir_arama_normal("ad") || ' ' || tekir_arama_normal("kod") || ' ' || tekir_arama_normal("barkod")
  ) STORED;

ALTER TABLE "faturalar" ADD COLUMN "arama_normal" TEXT
  GENERATED ALWAYS AS (tekir_arama_normal("no")) STORED;

-- `contains` araması LIKE '%terim%' üretir; trigram indeksi olmadan bu her
-- sorguda tam tarama demektir.
CREATE INDEX "cari_hesaplar_arama_normal_trgm_idx" ON "cari_hesaplar" USING GIN ("arama_normal" gin_trgm_ops);
CREATE INDEX "stok_kartlari_arama_normal_trgm_idx" ON "stok_kartlari" USING GIN ("arama_normal" gin_trgm_ops);
CREATE INDEX "faturalar_arama_normal_trgm_idx" ON "faturalar" USING GIN ("arama_normal" gin_trgm_ops);
