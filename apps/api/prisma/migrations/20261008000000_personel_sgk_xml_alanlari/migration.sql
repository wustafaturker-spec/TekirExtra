-- PRS-23/25 (P3-3): e-Bildirge toplu işe giriş XML'inin istediği kart alanları.
ALTER TABLE "personel" ADD COLUMN "mezuniyet_yili" INTEGER;
ALTER TABLE "personel" ADD COLUMN "mezuniyet_bolumu" TEXT;
ALTER TABLE "personel" ADD COLUMN "eski_hukumlu" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "personel" ADD CONSTRAINT "personel_mezuniyet_yili_check" CHECK ("mezuniyet_yili" IS NULL OR "mezuniyet_yili" BETWEEN 1900 AND 2100);

ALTER TABLE "personel_isyerleri" ADD COLUMN "csgb_is_kolu" INTEGER;
ALTER TABLE "personel_isyerleri" ADD CONSTRAINT "personel_isyerleri_csgb_is_kolu_check" CHECK ("csgb_is_kolu" IS NULL OR "csgb_is_kolu" BETWEEN 1 AND 28);
