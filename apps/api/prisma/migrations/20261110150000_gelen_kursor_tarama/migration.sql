-- EBLG-154: alınamayan belge varken kursör ilerlemez; planlayıcı son denemeyi buradan okur.
ALTER TABLE "ebelge_gelen_kursor" ADD COLUMN "son_tarama_at" TIMESTAMP(3);
