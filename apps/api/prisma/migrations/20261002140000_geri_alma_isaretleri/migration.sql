-- KSB-08: çek/senet son işlemi ve kredi kartı hareketi geri alma işaretleri.
ALTER TABLE "cek_senet_olaylari" ADD COLUMN "geri_alindi" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "geri_alma" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "kredi_karti_hareketleri" ADD COLUMN "geri_alinan_hareket_id" UUID;

CREATE UNIQUE INDEX "kredi_karti_hareketleri_geri_alinan_hareket_id_key" ON "kredi_karti_hareketleri"("geri_alinan_hareket_id");
