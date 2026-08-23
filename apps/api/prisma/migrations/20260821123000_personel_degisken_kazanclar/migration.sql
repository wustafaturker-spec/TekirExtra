ALTER TABLE "personel_donem_calismalari"
  ADD COLUMN "fazla_mesai_brut" DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN "prim_ikramiye_brut" DECIMAL(15,2) NOT NULL DEFAULT 0;

ALTER TABLE "personel_donem_calismalari"
  ADD CONSTRAINT "personel_donem_calismalari_degisken_kazanc_check"
  CHECK ("fazla_mesai_brut" >= 0 AND "prim_ikramiye_brut" >= 0);
