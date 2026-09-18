-- İhracat faturası alanları (EBLG-53, EBLG-54).
--
-- Fiili ihracat tarihi, teslim şartı ve taşıma şekli belgeye gider; gümrük
-- beyanname numarası gümrük kapandıktan sonra yalnız kayda işlenir, GİB'e
-- ikinci bir gönderim yapılmaz (karar 2026-09-18).

ALTER TABLE "faturalar"
  ADD COLUMN IF NOT EXISTS "ihracat_teslim_tarihi" DATE,
  ADD COLUMN IF NOT EXISTS "ihracat_teslim_sarti" TEXT,
  ADD COLUMN IF NOT EXISTS "ihracat_tasima_sekli" TEXT,
  ADD COLUMN IF NOT EXISTS "gumruk_beyanname_no" TEXT,
  ADD COLUMN IF NOT EXISTS "gumruk_beyanname_tarihi" DATE;
