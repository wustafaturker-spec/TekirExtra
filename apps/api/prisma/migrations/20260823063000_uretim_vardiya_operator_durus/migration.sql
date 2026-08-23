CREATE TABLE "uretim_vardiyalari" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "kod" TEXT NOT NULL,
  "ad" TEXT NOT NULL,
  "baslangic_saati" TEXT NOT NULL,
  "bitis_saati" TEXT NOT NULL,
  "aktif" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uretim_vardiyalari_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uretim_vardiyalari_tenant_id_kod_key" ON "uretim_vardiyalari"("tenant_id", "kod");
CREATE INDEX "uretim_vardiyalari_tenant_id_aktif_idx" ON "uretim_vardiyalari"("tenant_id", "aktif");
ALTER TABLE "uretim_vardiyalari" ADD CONSTRAINT "uretim_vardiyalari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "uretim_emri_operasyonlari" ADD COLUMN "vardiya_id" UUID, ADD COLUMN "operator_id" UUID;
CREATE INDEX "uretim_emri_operasyonlari_tenant_id_vardiya_id_operator_id_idx" ON "uretim_emri_operasyonlari"("tenant_id", "vardiya_id", "operator_id");
ALTER TABLE "uretim_emri_operasyonlari" ADD CONSTRAINT "uretim_emri_operasyonlari_vardiya_id_fkey" FOREIGN KEY ("vardiya_id") REFERENCES "uretim_vardiyalari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "uretim_emri_operasyonlari" ADD CONSTRAINT "uretim_emri_operasyonlari_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "uretim_duruslari" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "operasyon_id" UUID NOT NULL,
  "neden_kodu" TEXT NOT NULL,
  "aciklama" TEXT,
  "planli" BOOLEAN NOT NULL DEFAULT false,
  "baslangic" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "bitis" TIMESTAMP(3),
  "sure_dakika" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "olusturan_user_id" UUID NOT NULL,
  CONSTRAINT "uretim_duruslari_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "uretim_duruslari_tenant_id_operasyon_id_baslangic_idx" ON "uretim_duruslari"("tenant_id", "operasyon_id", "baslangic");
ALTER TABLE "uretim_duruslari" ADD CONSTRAINT "uretim_duruslari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "uretim_duruslari" ADD CONSTRAINT "uretim_duruslari_operasyon_id_fkey" FOREIGN KEY ("operasyon_id") REFERENCES "uretim_emri_operasyonlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "uretim_duruslari" ADD CONSTRAINT "uretim_duruslari_olusturan_user_id_fkey" FOREIGN KEY ("olusturan_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "uretim_vardiyalari" ("id", "tenant_id", "kod", "ad", "baslangic_saati", "bitis_saati")
SELECT gen_random_uuid(), "id", 'V1', 'Gündüz Vardiyası', '08:00', '16:00' FROM "tenants";
INSERT INTO "uretim_vardiyalari" ("id", "tenant_id", "kod", "ad", "baslangic_saati", "bitis_saati")
SELECT gen_random_uuid(), "id", 'V2', 'Akşam Vardiyası', '16:00', '00:00' FROM "tenants";

ALTER TABLE "uretim_vardiyalari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uretim_vardiyalari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "uretim_vardiyalari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "uretim_duruslari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uretim_duruslari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "uretim_duruslari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
