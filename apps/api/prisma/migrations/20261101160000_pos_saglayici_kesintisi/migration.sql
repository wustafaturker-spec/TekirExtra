-- KSB-37: sağlayıcının bildirdiği kesinti ve kart bilgisi. Tam kart numarası ve ham yanıt saklanmaz.
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "saglayici_komisyonu" DECIMAL(15,2);
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "saglayici_ucreti" DECIMAL(15,2);
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "isyerine_gecen" DECIMAL(15,2);
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "kart_markasi" TEXT;
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "kart_ailesi" TEXT;
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "kart_turu" TEXT;
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "kart_bin" TEXT;
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "kart_son4" TEXT;
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "fraud_durumu" INTEGER;
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "provizyon_kodu" TEXT;
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "host_referansi" TEXT;
