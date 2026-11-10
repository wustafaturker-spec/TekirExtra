-- ILT-09: varsayılan metinler koddadır; bu tablolar yalnız değiştirilmiş şablonları tutar.
CREATE TABLE "ileti_sablonlari" (
    "tenant_id" UUID NOT NULL,
    "tur" VARCHAR(40) NOT NULL,
    "konu" VARCHAR(200),
    "metin" TEXT NOT NULL,
    "guncelleyen_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ileti_sablonlari_pkey" PRIMARY KEY ("tenant_id", "tur")
);
ALTER TABLE "ileti_sablonlari" ADD CONSTRAINT "ileti_sablonlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ileti_sablonlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ileti_sablonlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_ileti_sablonlari ON "ileti_sablonlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE "platform_ileti_sablonlari" (
    "tur" VARCHAR(40) NOT NULL,
    "konu" VARCHAR(200) NOT NULL,
    "metin" TEXT NOT NULL,
    "guncelleyen_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_ileti_sablonlari_pkey" PRIMARY KEY ("tur")
);
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_ileti_sablonlari" TO tekir_platform;
REVOKE ALL ON "platform_ileti_sablonlari" FROM tekir_app;
