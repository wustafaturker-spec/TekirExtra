CREATE TABLE "personel_tatil_gunleri" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "tarih" DATE NOT NULL, "ad" TEXT NOT NULL,
  "yarim_gun" BOOLEAN NOT NULL DEFAULT false, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personel_tatil_gunleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personel_tatil_gunleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "personel_tatil_gunleri_tenant_id_tarih_key" ON "personel_tatil_gunleri"("tenant_id", "tarih");
CREATE INDEX "personel_tatil_gunleri_tenant_id_tarih_idx" ON "personel_tatil_gunleri"("tenant_id", "tarih");
ALTER TABLE "personel_tatil_gunleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personel_tatil_gunleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "personel_tatil_gunleri" USING (tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK (tenant_id=current_setting('app.tenant_id',true)::uuid);
