-- e-Arşiv internet satışı alanları (EBLG-56).
--
-- Satış internet üzerinden yapıldıysa GİB faturada ödeme, web adresi ve
-- gönderi bilgisini arar. İşaret sihirbazda konur, alanlar faturada durur.

ALTER TABLE "faturalar"
  ADD COLUMN IF NOT EXISTS "internet_satisi" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "internet_web_adresi" TEXT,
  ADD COLUMN IF NOT EXISTS "internet_odeme_sekli" TEXT,
  ADD COLUMN IF NOT EXISTS "internet_odeme_tarihi" DATE,
  ADD COLUMN IF NOT EXISTS "internet_odeme_aracisi" TEXT,
  ADD COLUMN IF NOT EXISTS "internet_tasiyici_unvan" TEXT,
  ADD COLUMN IF NOT EXISTS "internet_tasiyici_vkn" TEXT,
  ADD COLUMN IF NOT EXISTS "internet_gonderi_tarihi" DATE;
