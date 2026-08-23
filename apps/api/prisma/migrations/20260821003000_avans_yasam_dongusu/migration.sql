CREATE TYPE "PersonelAvansDurum" AS ENUM ('talep', 'onaylandi', 'odendi', 'kismen_mahsup', 'mahsup_edildi', 'reddedildi', 'iptal');
ALTER TABLE "personel_avans"
ADD COLUMN "durum" "PersonelAvansDurum" NOT NULL DEFAULT 'talep',
ADD COLUMN "olusturan_user_id" UUID,
ADD COLUMN "onaylayan_user_id" UUID,
ADD COLUMN "onay_tarihi" TIMESTAMP(3),
ADD COLUMN "ret_nedeni" TEXT,
ADD COLUMN "odenen_tutar" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN "mahsup_edilen_tutar" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN "kalan_tutar" DECIMAL(15,2) NOT NULL DEFAULT 0;
UPDATE "personel_avans" SET
  "durum" = CASE WHEN "odendi" THEN 'odendi'::"PersonelAvansDurum" ELSE 'talep'::"PersonelAvansDurum" END,
  "odenen_tutar" = CASE WHEN "odendi" THEN "tutar" ELSE 0 END,
  "kalan_tutar" = CASE WHEN "odendi" THEN "tutar" ELSE 0 END;
ALTER TABLE "personel_bordro_kalemleri" ADD COLUMN "avans_id" UUID;
ALTER TABLE "personel_bordro_kalemleri" ADD CONSTRAINT "personel_bordro_kalemleri_avans_id_fkey" FOREIGN KEY ("avans_id") REFERENCES "personel_avans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "personel_bordro_kalemleri_avans_id_idx" ON "personel_bordro_kalemleri"("avans_id");
