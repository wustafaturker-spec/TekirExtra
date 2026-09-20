-- SGK faturası (SGK e-Fatura Teknik Doküman): ilave fatura tipi, Kurum'da
-- tanımlı mükellef kodu/adı, dosya no ve fatura dönemi.
--
-- Sabit olanların (tip, kod, ad) varsayılanı firma kartında durur; faturaya
-- yazılanlar sihirbazda toplanır.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "sgk_ilave_fatura_tipi" TEXT,
  ADD COLUMN IF NOT EXISTS "sgk_mukellef_kodu" TEXT,
  ADD COLUMN IF NOT EXISTS "sgk_mukellef_adi" TEXT;

ALTER TABLE "faturalar"
  ADD COLUMN IF NOT EXISTS "sgk_ilave_fatura_tipi" TEXT,
  ADD COLUMN IF NOT EXISTS "sgk_mukellef_kodu" TEXT,
  ADD COLUMN IF NOT EXISTS "sgk_mukellef_adi" TEXT,
  ADD COLUMN IF NOT EXISTS "sgk_dosya_no" TEXT,
  ADD COLUMN IF NOT EXISTS "sgk_donem_baslangic" DATE,
  ADD COLUMN IF NOT EXISTS "sgk_donem_bitis" DATE;
