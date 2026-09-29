-- FTR-31: müşterinin talep (teklif isteği) referansı; tekliften faturaya taşınır.
ALTER TABLE "belgeler" ADD COLUMN "talep_no" TEXT;
ALTER TABLE "belgeler" ADD COLUMN "talep_tarihi" DATE;
ALTER TABLE "faturalar" ADD COLUMN "talep_no" TEXT;
ALTER TABLE "faturalar" ADD COLUMN "talep_tarihi" DATE;
