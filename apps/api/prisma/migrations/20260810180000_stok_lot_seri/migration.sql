CREATE TYPE "StokTakipTipi" AS ENUM ('yok', 'lot', 'seri');
ALTER TABLE "stok_kartlari" ADD COLUMN "takip_tipi" "StokTakipTipi" NOT NULL DEFAULT 'yok';
ALTER TABLE "fatura_satirlari" ADD COLUMN "parti_bilgileri" JSONB;
ALTER TABLE "belge_satirlari" ADD COLUMN "parti_bilgileri" JSONB;
ALTER TABLE "depo_transfer_kalemleri" ADD COLUMN "varyant_id" UUID;
ALTER TABLE "depo_transfer_kalemleri" ADD CONSTRAINT "depo_transfer_kalemleri_varyant_id_fkey" FOREIGN KEY ("varyant_id") REFERENCES "stok_varyantlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "stok_partileri" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "stok_id" UUID NOT NULL,
  "varyant_id" UUID, "depo_id" UUID NOT NULL, "lot_no" TEXT NOT NULL,
  "seri_no" TEXT, "son_kullanma_tarihi" DATE, "uretim_tarihi" DATE,
  "ilk_miktar" DECIMAL(15,3) NOT NULL, "kalan_miktar" DECIMAL(15,3) NOT NULL,
  "anahtar" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stok_partileri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stok_partileri_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stok_partileri_varyant_id_fkey" FOREIGN KEY ("varyant_id") REFERENCES "stok_varyantlari"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stok_partileri_depo_id_fkey" FOREIGN KEY ("depo_id") REFERENCES "depolar"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "stok_partileri_tenant_id_anahtar_key" ON "stok_partileri"("tenant_id", "anahtar");
CREATE UNIQUE INDEX "stok_partileri_tenant_id_seri_no_key" ON "stok_partileri"("tenant_id", "seri_no");
CREATE INDEX "stok_partileri_tenant_id_stok_id_varyant_id_depo_id_skt_idx" ON "stok_partileri"("tenant_id", "stok_id", "varyant_id", "depo_id", "son_kullanma_tarihi");

CREATE TABLE "stok_hareket_partileri" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "hareket_id" UUID NOT NULL,
  "parti_id" UUID NOT NULL, "miktar" DECIMAL(15,3) NOT NULL,
  CONSTRAINT "stok_hareket_partileri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stok_hareket_partileri_hareket_id_fkey" FOREIGN KEY ("hareket_id") REFERENCES "stok_hareketleri"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stok_hareket_partileri_parti_id_fkey" FOREIGN KEY ("parti_id") REFERENCES "stok_partileri"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "stok_hareket_partileri_tenant_id_hareket_id_idx" ON "stok_hareket_partileri"("tenant_id", "hareket_id");

ALTER TABLE "stok_partileri" ENABLE ROW LEVEL SECURITY; ALTER TABLE "stok_partileri" FORCE ROW LEVEL SECURITY;
ALTER TABLE "stok_hareket_partileri" ENABLE ROW LEVEL SECURITY; ALTER TABLE "stok_hareket_partileri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_stok_partileri ON "stok_partileri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_stok_hareket_partileri ON "stok_hareket_partileri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
