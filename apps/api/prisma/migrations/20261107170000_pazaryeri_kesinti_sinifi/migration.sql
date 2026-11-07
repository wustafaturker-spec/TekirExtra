-- PZR-06/08: komisyon gideri pazaryerinin e-Faturasından yazılır; kesinti
-- mutabakat kaydıdır. Kesintiye sınıf eklenir; giderleştirme yalnız stopajda.
ALTER TYPE "PazaryeriKesintiDurumu" ADD VALUE IF NOT EXISTS 'faturayla_eslesti';
ALTER TYPE "PazaryeriKesintiDurumu" ADD VALUE IF NOT EXISTS 'faturasiz';
CREATE TYPE "PazaryeriKesintiSinifi" AS ENUM ('faturali', 'stopaj', 'ceza', 'diger_faturasiz', 'siniflandirilmamis');
ALTER TABLE pazaryeri_kesintileri ADD COLUMN sinif "PazaryeriKesintiSinifi" NOT NULL DEFAULT 'siniflandirilmamis';
