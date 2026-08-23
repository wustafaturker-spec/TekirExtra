CREATE TYPE "UretimOperasyonDurum" AS ENUM ('planlandi', 'hazir', 'devam_ediyor', 'tamamlandi', 'beklemede', 'iptal');
CREATE TABLE "is_merkezleri" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL, "kod" TEXT NOT NULL, "ad" TEXT NOT NULL,
  "gunluk_kapasite_dakika" INTEGER NOT NULL DEFAULT 480, "verimlilik_yuzdesi" DECIMAL(5,2) NOT NULL DEFAULT 100, "saatlik_maliyet" DECIMAL(15,4) NOT NULL DEFAULT 0,
  "aktif" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "is_merkezleri_pkey" PRIMARY KEY ("id"), CONSTRAINT "is_merkezleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "is_merkezleri_tenant_id_kod_key" ON "is_merkezleri"("tenant_id", "kod");
CREATE INDEX "is_merkezleri_tenant_id_aktif_idx" ON "is_merkezleri"("tenant_id", "aktif");
CREATE TABLE "recete_operasyonlari" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL, "recete_id" UUID NOT NULL, "is_merkezi_id" UUID NOT NULL, "sira" INTEGER NOT NULL,
  "operasyon_kodu" TEXT NOT NULL, "operasyon_adi" TEXT NOT NULL, "hazirlik_dakika" DECIMAL(10,2) NOT NULL DEFAULT 0, "cevrim_dakika" DECIMAL(10,4) NOT NULL DEFAULT 0,
  CONSTRAINT "recete_operasyonlari_pkey" PRIMARY KEY ("id"), CONSTRAINT "recete_operasyonlari_recete_id_fkey" FOREIGN KEY ("recete_id") REFERENCES "urun_receteleri"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "recete_operasyonlari_is_merkezi_id_fkey" FOREIGN KEY ("is_merkezi_id") REFERENCES "is_merkezleri"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "recete_operasyonlari_recete_id_sira_key" ON "recete_operasyonlari"("recete_id", "sira");
CREATE INDEX "recete_operasyonlari_tenant_id_is_merkezi_id_idx" ON "recete_operasyonlari"("tenant_id", "is_merkezi_id");
CREATE TABLE "uretim_emri_operasyonlari" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL, "uretim_emri_id" UUID NOT NULL, "is_merkezi_id" UUID NOT NULL, "sira" INTEGER NOT NULL,
  "operasyon_kodu" TEXT NOT NULL, "operasyon_adi" TEXT NOT NULL, "planlanan_dakika" DECIMAL(12,2) NOT NULL, "gerceklesen_dakika" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "planlanan_baslangic" TIMESTAMP(3) NOT NULL, "planlanan_bitis" TIMESTAMP(3) NOT NULL, "fiili_baslangic" TIMESTAMP(3), "fiili_bitis" TIMESTAMP(3),
  "durum" "UretimOperasyonDurum" NOT NULL DEFAULT 'planlandi', CONSTRAINT "uretim_emri_operasyonlari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uretim_emri_operasyonlari_uretim_emri_id_fkey" FOREIGN KEY ("uretim_emri_id") REFERENCES "uretim_emirleri"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "uretim_emri_operasyonlari_is_merkezi_id_fkey" FOREIGN KEY ("is_merkezi_id") REFERENCES "is_merkezleri"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "uretim_emri_operasyonlari_uretim_emri_id_sira_key" ON "uretim_emri_operasyonlari"("uretim_emri_id", "sira");
CREATE INDEX "uretim_emri_operasyonlari_tenant_id_is_merkezi_id_planlanan_baslangic_idx" ON "uretim_emri_operasyonlari"("tenant_id", "is_merkezi_id", "planlanan_baslangic");
ALTER TABLE "is_merkezleri" ENABLE ROW LEVEL SECURITY; ALTER TABLE "is_merkezleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_is_merkezleri" ON "is_merkezleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "recete_operasyonlari" ENABLE ROW LEVEL SECURITY; ALTER TABLE "recete_operasyonlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_recete_operasyonlari" ON "recete_operasyonlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "uretim_emri_operasyonlari" ENABLE ROW LEVEL SECURITY; ALTER TABLE "uretim_emri_operasyonlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_uretim_emri_operasyonlari" ON "uretim_emri_operasyonlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
