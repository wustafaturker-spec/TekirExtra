-- KSB-35: POS hesabında işlem başı sabit ücret ve 2–12 taksit komisyon tablosu.
ALTER TABLE "pos_hesaplari" ADD COLUMN "islem_ucreti" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "pos_hesaplari" ADD COLUMN "taksit_oranlari" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "pos_hesaplari" ADD CONSTRAINT "pos_hesaplari_islem_ucreti_check" CHECK ("islem_ucreti" >= 0);
ALTER TABLE "pos_hesaplari" ADD CONSTRAINT "pos_hesaplari_taksit_oranlari_check" CHECK (jsonb_typeof("taksit_oranlari") = 'array');
