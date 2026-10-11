-- RPR-28: favori ve son kullanılan raporlar.
CREATE TABLE "rapor_tercihleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "favoriler" TEXT[],
    "son_kullanilanlar" TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rapor_tercihleri_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rapor_tercihleri_tenant_id_user_id_key" ON "rapor_tercihleri"("tenant_id", "user_id");

-- Kiracı yalıtımı (KLN-06)
ALTER TABLE "rapor_tercihleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rapor_tercihleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rapor_tercihleri"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
