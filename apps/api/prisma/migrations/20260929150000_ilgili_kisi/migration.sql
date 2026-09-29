-- FTR-32: müşteri tarafında ilgili kişi; tekliften faturaya kopyalanır.
ALTER TABLE "belgeler" ADD COLUMN "ilgili_kisi" TEXT;
ALTER TABLE "belgeler" ADD COLUMN "ilgili_kisi_gorevi" TEXT;
ALTER TABLE "faturalar" ADD COLUMN "ilgili_kisi" TEXT;
ALTER TABLE "faturalar" ADD COLUMN "ilgili_kisi_gorevi" TEXT;
