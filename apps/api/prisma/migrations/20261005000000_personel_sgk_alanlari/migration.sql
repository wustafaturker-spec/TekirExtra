-- PRS-23/24 (P3-3): SGK bildirge ve MUHSGK ön dökümü için kart alanları ve bildirge takibi.
ALTER TABLE "personel" ADD COLUMN "meslek_kodu" TEXT;
ALTER TABLE "personel" ADD COLUMN "sgk_belge_turu" TEXT NOT NULL DEFAULT '1';
ALTER TABLE "personel" ADD COLUMN "ogrenim_durumu" INTEGER;
ALTER TABLE "personel" ADD COLUMN "tesvik_kanun_no" TEXT;
ALTER TABLE "personel" ADD CONSTRAINT "personel_ogrenim_durumu_check" CHECK ("ogrenim_durumu" IS NULL OR "ogrenim_durumu" BETWEEN 0 AND 7);

ALTER TABLE "personel_istihdam_donemleri" ADD COLUMN "ise_giris_bildirge_tarihi" DATE;
ALTER TABLE "personel_istihdam_donemleri" ADD COLUMN "ise_giris_bildirge_no" TEXT;
ALTER TABLE "personel_istihdam_donemleri" ADD COLUMN "isten_cikis_bildirge_tarihi" DATE;
ALTER TABLE "personel_istihdam_donemleri" ADD COLUMN "isten_cikis_bildirge_no" TEXT;
ALTER TABLE "personel_istihdam_donemleri" ADD COLUMN "sgk_cikis_kodu" TEXT;
