CREATE TYPE "UretimCiktiTip" AS ENUM ('yan_urun', 'ortak_urun');
CREATE TABLE "urun_recetesi_ciktilari" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "recete_id" UUID NOT NULL, "stok_id" UUID NOT NULL, "varyant_id" UUID, "tip" "UretimCiktiTip" NOT NULL, "miktar" DECIMAL(15,3) NOT NULL,
  CONSTRAINT "urun_recetesi_ciktilari_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "urun_recetesi_ciktilari_recete_id_stok_id_varyant_id_key" ON "urun_recetesi_ciktilari"("recete_id", "stok_id", "varyant_id");
CREATE INDEX "urun_recetesi_ciktilari_tenant_id_stok_id_idx" ON "urun_recetesi_ciktilari"("tenant_id", "stok_id");
ALTER TABLE "urun_recetesi_ciktilari" ADD CONSTRAINT "urun_recetesi_ciktilari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "urun_recetesi_ciktilari" ADD CONSTRAINT "urun_recetesi_ciktilari_recete_id_fkey" FOREIGN KEY ("recete_id") REFERENCES "urun_receteleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "urun_recetesi_ciktilari" ADD CONSTRAINT "urun_recetesi_ciktilari_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "urun_recetesi_ciktilari" ADD CONSTRAINT "urun_recetesi_ciktilari_varyant_id_fkey" FOREIGN KEY ("varyant_id") REFERENCES "stok_varyantlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "uretim_emri_ciktilari" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "uretim_emri_id" UUID NOT NULL, "recete_cikti_id" UUID NOT NULL, "stok_id" UUID NOT NULL, "varyant_id" UUID, "tip" "UretimCiktiTip" NOT NULL, "planlanan_miktar" DECIMAL(15,3) NOT NULL, "uretilen_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,
  CONSTRAINT "uretim_emri_ciktilari_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uretim_emri_ciktilari_uretim_emri_id_recete_cikti_id_key" ON "uretim_emri_ciktilari"("uretim_emri_id", "recete_cikti_id");
CREATE INDEX "uretim_emri_ciktilari_tenant_id_stok_id_idx" ON "uretim_emri_ciktilari"("tenant_id", "stok_id");
ALTER TABLE "uretim_emri_ciktilari" ADD CONSTRAINT "uretim_emri_ciktilari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "uretim_emri_ciktilari" ADD CONSTRAINT "uretim_emri_ciktilari_uretim_emri_id_fkey" FOREIGN KEY ("uretim_emri_id") REFERENCES "uretim_emirleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "uretim_emri_ciktilari" ADD CONSTRAINT "uretim_emri_ciktilari_recete_cikti_id_fkey" FOREIGN KEY ("recete_cikti_id") REFERENCES "urun_recetesi_ciktilari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "uretim_emri_ciktilari" ADD CONSTRAINT "uretim_emri_ciktilari_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "uretim_emri_ciktilari" ADD CONSTRAINT "uretim_emri_ciktilari_varyant_id_fkey" FOREIGN KEY ("varyant_id") REFERENCES "stok_varyantlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "urun_recetesi_ciktilari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "urun_recetesi_ciktilari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "urun_recetesi_ciktilari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "uretim_emri_ciktilari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uretim_emri_ciktilari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "uretim_emri_ciktilari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
