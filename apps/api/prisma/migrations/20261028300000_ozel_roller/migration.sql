-- KLN-20: özel roller. Bir şablon (hazır rol) temel alınır, yalnız kutu
-- kapatılır ("modul.islem" anahtarları). Kullanıcının `rol` sütunu şablon
-- rolü olarak kalır; `ozel_rol_id` ek kısıtı taşır.
CREATE TABLE "ozel_roller" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ad" VARCHAR(80) NOT NULL,
    "sablon_rol" "Rol" NOT NULL,
    "kapali_kutular" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ozel_roller_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ozel_roller_sablon_check" CHECK ("sablon_rol" NOT IN ('calisan', 'b2b_bayi'))
);
CREATE UNIQUE INDEX "ozel_roller_tenant_id_ad_key" ON "ozel_roller"("tenant_id", "ad");
ALTER TABLE "ozel_roller" ADD CONSTRAINT "ozel_roller_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE ozel_roller ENABLE ROW LEVEL SECURITY;
ALTER TABLE ozel_roller FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ozel_roller USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE "users" ADD COLUMN "ozel_rol_id" UUID;
ALTER TABLE "users" ADD CONSTRAINT "users_ozel_rol_id_fkey" FOREIGN KEY ("ozel_rol_id") REFERENCES "ozel_roller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "users_ozel_rol_id_idx" ON "users"("ozel_rol_id");
