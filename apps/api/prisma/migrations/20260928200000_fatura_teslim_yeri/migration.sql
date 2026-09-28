-- FTR-30: faturada teslim yeri (irsaliyeden gelir, cari adresinden seçilir ya da elle girilir).
ALTER TABLE "faturalar" ADD COLUMN "teslimat_adres" TEXT;
ALTER TABLE "faturalar" ADD COLUMN "teslimat_il" TEXT;
ALTER TABLE "faturalar" ADD COLUMN "teslimat_ilce" TEXT;
ALTER TABLE "faturalar" ADD COLUMN "teslimat_posta_kodu" TEXT;
