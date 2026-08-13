ALTER TABLE "cek_senetler"
  ADD COLUMN "cek_no" TEXT,
  ADD COLUMN "islem_tarihi" DATE NOT NULL DEFAULT CURRENT_DATE;

CREATE INDEX "cek_senetler_tenant_id_cek_no_idx"
  ON "cek_senetler"("tenant_id", "cek_no");
