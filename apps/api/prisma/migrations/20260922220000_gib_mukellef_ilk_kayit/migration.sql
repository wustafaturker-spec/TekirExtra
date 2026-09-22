-- CARI-23: mükellefin GİB'e ilk kaydı (listedeki FirstCreationTime).
-- Liste her senkronda baştan yazıldığından mevcut satırlar bir sonraki
-- senkronda dolar; o zamana kadar tarih boş görünür.
ALTER TABLE "gib_mukellefler" ADD COLUMN "ilk_kayit_zamani" TIMESTAMP(3);
