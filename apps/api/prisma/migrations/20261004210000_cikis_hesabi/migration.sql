-- PRS-18 (P3-2): çıkış bordrosu (kıdem, ihbar, kullanılmamış izin ücreti).
ALTER TABLE "personel_istihdam_donemleri" ADD COLUMN "cikis_nedeni" TEXT, ADD COLUMN "cikis_hesabi" JSONB;
