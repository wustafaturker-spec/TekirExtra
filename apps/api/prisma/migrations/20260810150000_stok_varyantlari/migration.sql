CREATE TABLE "stok_varyantlari" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "stok_id" UUID NOT NULL,
  "kod" TEXT NOT NULL, "ad" TEXT NOT NULL, "nitelikler" JSONB NOT NULL,
  "barkod" TEXT, "alis_fiyati" DECIMAL(15,4), "satis_fiyati" DECIMAL(15,4),
  "mevcut_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,
  "rezerve_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,
  "yoldaki_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,
  "aktif" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stok_varyantlari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stok_varyantlari_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "stok_varyantlari_tenant_id_kod_key" ON "stok_varyantlari"("tenant_id", "kod");
CREATE UNIQUE INDEX "stok_varyantlari_tenant_id_barkod_key" ON "stok_varyantlari"("tenant_id", "barkod");
CREATE INDEX "stok_varyantlari_tenant_id_stok_id_idx" ON "stok_varyantlari"("tenant_id", "stok_id");

CREATE TABLE "stok_varyant_depo_bakiyeleri" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "varyant_id" UUID NOT NULL, "depo_id" UUID NOT NULL,
  "mevcut_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,
  "rezerve_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,
  "yoldaki_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,
  CONSTRAINT "stok_varyant_depo_bakiyeleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stok_varyant_depo_bakiyeleri_varyant_id_fkey" FOREIGN KEY ("varyant_id") REFERENCES "stok_varyantlari"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stok_varyant_depo_bakiyeleri_depo_id_fkey" FOREIGN KEY ("depo_id") REFERENCES "depolar"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "stok_varyant_depo_bakiyeleri_tenant_id_varyant_id_depo_id_key" ON "stok_varyant_depo_bakiyeleri"("tenant_id", "varyant_id", "depo_id");
CREATE INDEX "stok_varyant_depo_bakiyeleri_tenant_id_depo_id_idx" ON "stok_varyant_depo_bakiyeleri"("tenant_id", "depo_id");

ALTER TABLE "stok_hareketleri" ADD COLUMN "varyant_id" UUID;
ALTER TABLE "stok_hareketleri" ADD CONSTRAINT "stok_hareketleri_varyant_id_fkey" FOREIGN KEY ("varyant_id") REFERENCES "stok_varyantlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fatura_satirlari" ADD COLUMN "varyant_id" UUID;
ALTER TABLE "fatura_satirlari" ADD CONSTRAINT "fatura_satirlari_varyant_id_fkey" FOREIGN KEY ("varyant_id") REFERENCES "stok_varyantlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "belge_satirlari" ADD COLUMN "varyant_id" UUID;
ALTER TABLE "belge_satirlari" ADD CONSTRAINT "belge_satirlari_varyant_id_fkey" FOREIGN KEY ("varyant_id") REFERENCES "stok_varyantlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stok_varyantlari" ENABLE ROW LEVEL SECURITY; ALTER TABLE "stok_varyantlari" FORCE ROW LEVEL SECURITY;
ALTER TABLE "stok_varyant_depo_bakiyeleri" ENABLE ROW LEVEL SECURITY; ALTER TABLE "stok_varyant_depo_bakiyeleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_stok_varyantlari ON "stok_varyantlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_stok_varyant_depo_bakiyeleri ON "stok_varyant_depo_bakiyeleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
