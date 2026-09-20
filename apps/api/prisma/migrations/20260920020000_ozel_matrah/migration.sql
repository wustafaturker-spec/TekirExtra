-- Özel matrah faturası (KDV Kanunu 23; UBL `InvoiceTypeCode` OZELMATRAH).
--
-- Satış bedeli KDV'yi içerir: satırlar KDV'siz yazılır, hesaplanan KDV yalnız
-- belge düzeyinde, burada tutulan özel matrah ve oran üzerinden bildirilir.

ALTER TABLE "faturalar"
  ADD COLUMN IF NOT EXISTS "ozel_matrah_kodu" TEXT,
  ADD COLUMN IF NOT EXISTS "ozel_matrah_tutari" NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS "ozel_matrah_orani" NUMERIC(5,2);
