-- FTR-45: tekrarlayan planda fiyat kaynağı (şablon fiyatı ya da güncel fiyat).
CREATE TYPE "TekrarFiyatKaynagi" AS ENUM ('sablon', 'guncel');

ALTER TABLE "tekrarlayan_faturalar"
  ADD COLUMN "fiyat_kaynagi" "TekrarFiyatKaynagi" NOT NULL DEFAULT 'sablon';
