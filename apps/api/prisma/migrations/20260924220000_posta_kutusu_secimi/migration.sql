-- EBLG-86: alıcı posta kutusu seçimi. Kutunun GİB kayıt zamanı seçim kuralında
-- en yeni kaydı ayırt eder; mevcut liste bir sonraki senkronda dolar.
ALTER TABLE "gib_mukellefler" ADD COLUMN "kutu_kayit_zamani" TIMESTAMP(3);

-- Cari kartında elle seçilen kutu, listede durduğu sürece kuralın önüne geçer.
ALTER TABLE "cari_hesaplar" ADD COLUMN "efatura_posta_kutusu" TEXT;
ALTER TABLE "cari_hesaplar" ADD COLUMN "eirsaliye_posta_kutusu" TEXT;
