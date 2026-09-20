-- Özel matrah senaryosu (InvoiceTypeCode OZELMATRAH). Enum eki ayrı
-- migrasyondadır: PostgreSQL yeni enum değerini aynı işlemde kullandırmaz.

ALTER TYPE "FaturaSenaryo" ADD VALUE IF NOT EXISTS 'ozelmatrah';
