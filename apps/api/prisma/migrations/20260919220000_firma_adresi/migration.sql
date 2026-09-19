-- Firma adresi, iletişim, MERSİS ve ticaret sicil numarası (EBLG-62).
--
-- e-Fatura, e-Arşiv ve e-İrsaliye'nin satıcı tarafına yazılır; önceden yerine
-- sabit "Merkez/Istanbul" gidiyordu. Adres eksikse e-belge gönderimi durur.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "adres" TEXT,
  ADD COLUMN IF NOT EXISTS "ilce" TEXT,
  ADD COLUMN IF NOT EXISTS "il" TEXT,
  ADD COLUMN IF NOT EXISTS "posta_kodu" TEXT,
  ADD COLUMN IF NOT EXISTS "telefon" TEXT,
  ADD COLUMN IF NOT EXISTS "eposta" TEXT,
  ADD COLUMN IF NOT EXISTS "web_sitesi" TEXT,
  ADD COLUMN IF NOT EXISTS "mersis_no" TEXT,
  ADD COLUMN IF NOT EXISTS "ticaret_sicil_no" TEXT;
