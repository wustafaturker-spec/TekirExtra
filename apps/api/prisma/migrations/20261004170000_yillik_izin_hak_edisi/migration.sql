-- PRS-08: yıllık izin otomatik hak edişi (kıdem + yaş kuralı).
ALTER TABLE "personel" ADD COLUMN "dogum_tarihi" DATE;
ALTER TABLE "personel_izin_bakiye_hareketleri" ADD COLUMN "donem_ref" TEXT;
CREATE UNIQUE INDEX "personel_izin_bakiye_hareketleri_donem_ref_key" ON "personel_izin_bakiye_hareketleri"("tenant_id", "personel_id", "izin_turu_id", "donem_ref") WHERE "donem_ref" IS NOT NULL;
