-- KSB-43: POS iadesinin sağlayıcıya gönderilmesi.
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "iade_kilidi" TIMESTAMP(3);
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "bekleyen_saglayici_iade" JSONB;
ALTER TABLE "pos_iadeleri" ADD COLUMN "saglayiciya_gonderildi" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pos_iadeleri" ADD COLUMN "saglayici_iade_ref" TEXT;
