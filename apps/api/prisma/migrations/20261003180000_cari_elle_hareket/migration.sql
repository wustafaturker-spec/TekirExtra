-- CARI-27/28: elle cari düzeltmesinin muhasebe karşı hesabı (boşsa 679/689 eşlemesi).
ALTER TABLE "cari_hareketler" ADD COLUMN "karsi_hesap_kodu" TEXT;
