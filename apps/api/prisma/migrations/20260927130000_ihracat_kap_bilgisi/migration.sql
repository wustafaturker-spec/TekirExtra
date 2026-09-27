-- EBLG-103: ihracat faturasında kalem bazında kap bilgisi (cinsi, numarası, adedi).
ALTER TABLE "fatura_satirlari" ADD COLUMN "ihracat_kap_cinsi" TEXT;
ALTER TABLE "fatura_satirlari" ADD COLUMN "ihracat_kap_no" TEXT;
ALTER TABLE "fatura_satirlari" ADD COLUMN "ihracat_kap_adet" INTEGER;
