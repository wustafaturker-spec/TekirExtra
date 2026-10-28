-- KSB-25: mahsup kapaması da tek kaynaklıdır; kaynak sütunları arasına mahsup_id girer.
ALTER TABLE "fatura_kapamalari" DROP CONSTRAINT "fatura_kapamalari_tek_kaynak";
ALTER TABLE "fatura_kapamalari" ADD CONSTRAINT "fatura_kapamalari_tek_kaynak"
  CHECK (num_nonnulls(kasa_banka_hareket_id, kredi_karti_hareket_id, cek_senet_id, iade_fatura_id, mahsup_id) = 1);
