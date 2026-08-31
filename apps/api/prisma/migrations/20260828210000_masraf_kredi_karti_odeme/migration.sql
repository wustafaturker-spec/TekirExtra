ALTER TABLE "masraf_odemeleri"
ALTER COLUMN "hareket_id" DROP NOT NULL,
ADD COLUMN "kredi_karti_id" UUID,
ADD COLUMN "kredi_karti_hareket_id" UUID;

CREATE UNIQUE INDEX "masraf_odemeleri_kredi_karti_hareket_id_key"
ON "masraf_odemeleri"("kredi_karti_hareket_id");

ALTER TABLE "masraf_odemeleri"
ADD CONSTRAINT "masraf_odemeleri_kredi_karti_id_fkey"
FOREIGN KEY ("kredi_karti_id") REFERENCES "kredi_kartlari"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "masraf_odemeleri"
ADD CONSTRAINT "masraf_odemeleri_kredi_karti_hareket_id_fkey"
FOREIGN KEY ("kredi_karti_hareket_id") REFERENCES "kredi_karti_hareketleri"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
