CREATE TYPE "BordroMevzuatDurum" AS ENUM ('taslak','aktif','arsiv');
CREATE TABLE "bordro_mevzuat_setleri" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "ad" TEXT NOT NULL, "surum" INTEGER NOT NULL,
  "yururluk_baslangic" DATE NOT NULL, "yururluk_bitis" DATE, "durum" "BordroMevzuatDurum" NOT NULL DEFAULT 'taslak',
  "parametreler" JSONB NOT NULL, "kaynak_notu" TEXT, "olusturan_user_id" UUID NOT NULL, "onaylayan_user_id" UUID, "onay_tarihi" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bordro_mevzuat_setleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bordro_mevzuat_setleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "bordro_mevzuat_setleri_tenant_id_surum_key" ON "bordro_mevzuat_setleri"("tenant_id","surum");
CREATE INDEX "bordro_mevzuat_setleri_tenant_id_durum_yururluk_baslangic_idx" ON "bordro_mevzuat_setleri"("tenant_id","durum","yururluk_baslangic");
ALTER TABLE "bordro_mevzuat_setleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bordro_mevzuat_setleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bordro_mevzuat_setleri" USING (tenant_id=current_setting('app.tenant_id',true)::uuid) WITH CHECK (tenant_id=current_setting('app.tenant_id',true)::uuid);
