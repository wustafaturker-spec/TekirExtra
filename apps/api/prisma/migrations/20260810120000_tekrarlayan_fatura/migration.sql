CREATE TYPE "TekrarSikligi" AS ENUM ('haftalik', 'aylik', 'yillik');

CREATE TABLE "tekrarlayan_faturalar" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "ad" TEXT NOT NULL,
  "sablon_fatura_id" UUID NOT NULL,
  "siklik" "TekrarSikligi" NOT NULL,
  "aralik" INTEGER NOT NULL DEFAULT 1,
  "sonraki_tarih" DATE NOT NULL,
  "bitis_tarihi" DATE,
  "aktif" BOOLEAN NOT NULL DEFAULT true,
  "son_uretim_tarihi" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tekrarlayan_faturalar_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tekrarlayan_faturalar_sablon_fatura_id_fkey" FOREIGN KEY ("sablon_fatura_id") REFERENCES "faturalar"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "faturalar" ADD COLUMN "tekrarlayan_plan_id" UUID;
ALTER TABLE "faturalar" ADD COLUMN "planlanan_tarih" DATE;
ALTER TABLE "faturalar" ADD CONSTRAINT "faturalar_tekrarlayan_plan_id_fkey" FOREIGN KEY ("tekrarlayan_plan_id") REFERENCES "tekrarlayan_faturalar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tekrarlayan_faturalar_tenant_id_aktif_sonraki_tarih_idx" ON "tekrarlayan_faturalar"("tenant_id", "aktif", "sonraki_tarih");
CREATE UNIQUE INDEX "faturalar_tekrarlayan_plan_id_planlanan_tarih_key" ON "faturalar"("tekrarlayan_plan_id", "planlanan_tarih");

ALTER TABLE "tekrarlayan_faturalar" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tekrarlayan_faturalar" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tekrarlayan_faturalar ON "tekrarlayan_faturalar"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
