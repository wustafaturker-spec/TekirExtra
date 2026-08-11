ALTER TYPE "BaglantiAile" ADD VALUE 'sms';

ALTER TABLE "pos_tahsilatlari"
  ADD COLUMN "sms_gonderim_tarihi" TIMESTAMP(3),
  ADD COLUMN "sms_gorev_id" TEXT,
  ADD COLUMN "sms_hatasi" TEXT;
