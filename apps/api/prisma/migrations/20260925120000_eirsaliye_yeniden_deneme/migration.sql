-- EBLG-94: geçici hatayla düşen e-İrsaliye gönderimi aynı numarayla kendiliğinden yeniden denenir.
ALTER TABLE "eirsaliye_kayitlari" ADD COLUMN "gecici_hata" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "eirsaliye_kayitlari" ADD COLUMN "yeniden_deneme_sayisi" INTEGER NOT NULL DEFAULT 0;
