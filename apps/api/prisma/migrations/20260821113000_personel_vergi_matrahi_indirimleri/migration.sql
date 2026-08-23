ALTER TABLE "personel_donem_calismalari"
  ADD COLUMN "sahis_sigorta_primi" DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN "hayat_sigorta_primi" DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN "sendika_aidati" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "personel_donem_calismalari" ADD CONSTRAINT "personel_donem_indirimleri_pozitif_check" CHECK ("sahis_sigorta_primi" >= 0 AND "hayat_sigorta_primi" >= 0 AND "sendika_aidati" >= 0);
