-- FTR-44: tekrarlayan fatura planında dönem değişkenli açıklama/not şablonu.
CREATE TYPE "FaturalananDonem" AS ENUM ('bu_donem', 'onceki_donem');

ALTER TABLE "tekrarlayan_faturalar"
  ADD COLUMN "aciklama_sablonu" TEXT,
  ADD COLUMN "not_sablonu" TEXT,
  ADD COLUMN "faturalanan_donem" "FaturalananDonem" NOT NULL DEFAULT 'bu_donem';
