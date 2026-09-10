-- e-İrsaliye taşıma bilgileri (EBLG-23): GİB fiili sevk zamanını ve taşıyanı
-- ister. Taşıyıcı boşsa mal kendi aracımızla götürülmüş sayılır.
ALTER TABLE "belgeler"
  ADD COLUMN "fiili_sevk_zamani" TIMESTAMP(3),
  ADD COLUMN "tasiyici_cari_id" UUID,
  ADD COLUMN "plaka" TEXT,
  ADD COLUMN "dorse_plaka" TEXT,
  ADD COLUMN "sofor_adi" TEXT,
  ADD COLUMN "sofor_soyadi" TEXT,
  ADD COLUMN "sofor_tckn" TEXT;

ALTER TABLE "belgeler"
  ADD CONSTRAINT "belgeler_tasiyici_cari_id_fkey"
  FOREIGN KEY ("tasiyici_cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "belgeler_tenant_id_tasiyici_cari_id_idx" ON "belgeler"("tenant_id", "tasiyici_cari_id");
