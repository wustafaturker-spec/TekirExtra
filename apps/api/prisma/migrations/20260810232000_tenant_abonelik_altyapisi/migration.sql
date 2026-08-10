CREATE TYPE "AbonelikDurumu" AS ENUM ('deneme', 'aktif', 'askida', 'iptal');

CREATE TABLE "tenant_abonelikleri" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "plan_kodu" TEXT NOT NULL DEFAULT 'v1',
  "durum" "AbonelikDurumu" NOT NULL DEFAULT 'aktif',
  "fatura_epostasi" TEXT,
  "faturalandirma_unvani" TEXT,
  "saglayici" TEXT,
  "saglayici_musteri_ref" TEXT,
  "donem_baslangici" TIMESTAMP(3),
  "donem_sonu" TIMESTAMP(3),
  "iptal_tarihi" TIMESTAMP(3),
  "meta" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_abonelikleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_abonelikleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "tenant_abonelikleri_tenant_id_key" ON "tenant_abonelikleri"("tenant_id");
CREATE INDEX "tenant_abonelikleri_durum_donem_sonu_idx" ON "tenant_abonelikleri"("durum", "donem_sonu");

INSERT INTO "tenant_abonelikleri" ("id", "tenant_id", "plan_kodu", "durum", "updated_at")
SELECT gen_random_uuid(), "id", 'v1', 'aktif', CURRENT_TIMESTAMP FROM "tenants";

ALTER TABLE "tenant_abonelikleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_abonelikleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenant_abonelikleri ON "tenant_abonelikleri"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
