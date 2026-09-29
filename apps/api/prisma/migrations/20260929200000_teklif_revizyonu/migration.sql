-- FTR-34: teklif revizyonu. Sürümler aynı numarayı taşır; eski sürüm "revize_edildi" olur.
ALTER TYPE "ZincirBelgeDurum" ADD VALUE IF NOT EXISTS 'revize_edildi';

ALTER TABLE "belgeler" ADD COLUMN "revizyon_no" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "belgeler" ADD COLUMN "revizyon_kok_id" UUID;
ALTER TABLE "belgeler" ADD CONSTRAINT "belgeler_revizyon_kok_id_fkey" FOREIGN KEY ("revizyon_kok_id") REFERENCES "belgeler"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "belgeler_tenant_id_revizyon_kok_id_idx" ON "belgeler"("tenant_id", "revizyon_kok_id");

DROP INDEX "belgeler_tenant_id_no_key";
CREATE UNIQUE INDEX "belgeler_tenant_id_no_revizyon_no_key" ON "belgeler"("tenant_id", "no", "revizyon_no");
