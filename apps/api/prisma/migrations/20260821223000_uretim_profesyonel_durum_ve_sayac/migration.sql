ALTER TYPE "UretimEmriDurum" ADD VALUE IF NOT EXISTS 'planlandi';
ALTER TYPE "UretimEmriDurum" ADD VALUE IF NOT EXISTS 'malzeme_bekliyor';
ALTER TYPE "UretimEmriDurum" ADD VALUE IF NOT EXISTS 'hazir';
ALTER TYPE "UretimEmriDurum" ADD VALUE IF NOT EXISTS 'uretimde';
ALTER TYPE "UretimEmriDurum" ADD VALUE IF NOT EXISTS 'kismen_tamamlandi';
ALTER TYPE "UretimEmriDurum" ADD VALUE IF NOT EXISTS 'beklemede';
ALTER TYPE "UretimEmriDurum" ADD VALUE IF NOT EXISTS 'durduruldu';
ALTER TYPE "UretimEmriDurum" ADD VALUE IF NOT EXISTS 'iptal_talebi';

CREATE TABLE "uretim_sayaclari" (
  "tenant_id" UUID NOT NULL,
  "yil" INTEGER NOT NULL,
  "son_sira" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "uretim_sayaclari_pkey" PRIMARY KEY ("tenant_id", "yil"),
  CONSTRAINT "uretim_sayaclari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "uretim_sayaclari" ("tenant_id", "yil", "son_sira")
SELECT "tenant_id", EXTRACT(YEAR FROM "tarih")::integer, COUNT(*)::integer
FROM "uretim_emirleri"
GROUP BY "tenant_id", EXTRACT(YEAR FROM "tarih");

ALTER TABLE "uretim_sayaclari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uretim_sayaclari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_uretim_sayaclari" ON "uretim_sayaclari"
USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
