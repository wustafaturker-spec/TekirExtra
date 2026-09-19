-- KAMU senaryosu (şematron 14.09.2026 §4 + kamuya satış).
--
-- Kamu idaresine kesilen e-Fatura ödemeyi yapacak harcama biriminin VKN'sini
-- ve ödemenin yapılacağı IBAN'ı taşır. Alıcının kamu olduğu GİB mükellef
-- listesinin <Type> alanından okunur; listede ÖZEL görünen kurumlar için
-- cari kartında elle işaret konur. Harcama birimi kartta varsayılan durur,
-- sihirbazda faturaya özel yazılır.

ALTER TABLE "gib_mukellefler"
  ADD COLUMN IF NOT EXISTS "tur" TEXT;

ALTER TABLE "cari_hesaplar"
  ADD COLUMN IF NOT EXISTS "kamu_idaresi" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "harcama_birimi_vkn" TEXT,
  ADD COLUMN IF NOT EXISTS "harcama_birimi_adi" TEXT;

ALTER TABLE "faturalar"
  ADD COLUMN IF NOT EXISTS "kamu_harcama_birimi_vkn" TEXT,
  ADD COLUMN IF NOT EXISTS "kamu_harcama_birimi_adi" TEXT,
  ADD COLUMN IF NOT EXISTS "kamu_iban" TEXT;
