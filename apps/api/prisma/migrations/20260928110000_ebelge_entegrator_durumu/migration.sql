-- EBLG-112: faturanın entegratördeki ham durum adı; GİB'in alıcıya teslimini bekleyen (1200) `iletildi` belge sorgulanmaya devam etsin diye.
ALTER TABLE "ebelge_kayitlari" ADD COLUMN "entegrator_durumu" TEXT;
