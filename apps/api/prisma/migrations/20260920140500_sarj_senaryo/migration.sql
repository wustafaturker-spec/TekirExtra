-- Şarj senaryoları (InvoiceTypeCode SARJ / SARJANLIK). Enum ekleri ayrı
-- migrasyondadır: PostgreSQL yeni enum değerini aynı işlemde kullandırmaz.

ALTER TYPE "FaturaSenaryo" ADD VALUE IF NOT EXISTS 'sarj';
ALTER TYPE "FaturaSenaryo" ADD VALUE IF NOT EXISTS 'sarjanlik';
