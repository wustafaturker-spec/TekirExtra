CREATE TABLE "abonelik_degisiklikleri" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "onceki_plan" TEXT,
  "yeni_plan" TEXT NOT NULL,
  "onceki_durum" "AbonelikDurumu",
  "yeni_durum" "AbonelikDurumu" NOT NULL,
  "neden" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "abonelik_degisiklikleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "abonelik_degisiklikleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "abonelik_degisiklikleri_tenant_id_created_at_idx" ON "abonelik_degisiklikleri"("tenant_id", "created_at");

ALTER TABLE "abonelik_degisiklikleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "abonelik_degisiklikleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_abonelik_degisiklikleri ON "abonelik_degisiklikleri"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
