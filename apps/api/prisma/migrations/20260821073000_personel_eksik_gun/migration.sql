CREATE TYPE "PersonelEksikGunNedeni" AS ENUM ('istirahat','ucretsiz_izin','disiplin','gozaltina_alinma','kismi_istihdam','puantaj','diger');
CREATE TABLE "personel_donem_calismalari" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "personel_id" UUID NOT NULL, "yil" INTEGER NOT NULL, "ay" INTEGER NOT NULL,
  "prim_gunu" INTEGER NOT NULL DEFAULT 30, "eksik_gun_nedeni" "PersonelEksikGunNedeni", "aciklama" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personel_donem_calismalari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personel_donem_calismalari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personel_donem_calismalari_personel_id_fkey" FOREIGN KEY ("personel_id") REFERENCES "personel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "personel_donem_calismalari_tenant_id_personel_id_yil_ay_key" ON "personel_donem_calismalari"("tenant_id","personel_id","yil","ay");
CREATE INDEX "personel_donem_calismalari_tenant_id_yil_ay_idx" ON "personel_donem_calismalari"("tenant_id","yil","ay");
ALTER TABLE "personel_donem_calismalari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personel_donem_calismalari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "personel_donem_calismalari" USING (tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK (tenant_id=current_setting('app.tenant_id',true)::uuid);
ALTER TABLE "personel_bordro" ADD COLUMN "prim_gunu" INTEGER NOT NULL DEFAULT 30, ADD COLUMN "eksik_gun_nedeni" "PersonelEksikGunNedeni";
