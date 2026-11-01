-- KSB-38: bildirimi gelmemiş iyzico taleplerinin sağlayıcıdan son sorgu zamanı.
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "saglayici_sorgu_tarihi" TIMESTAMP(3);
