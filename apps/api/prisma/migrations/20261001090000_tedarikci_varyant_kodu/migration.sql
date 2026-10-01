-- STK-23: tedarikçinin varyant başına ürün kodu.
CREATE TABLE "stok_tedarikci_varyant_kodlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stok_tedarikci_id" UUID NOT NULL,
    "varyant_id" UUID NOT NULL,
    "tedarikci_urun_kodu" TEXT NOT NULL,

    CONSTRAINT "stok_tedarikci_varyant_kodlari_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stok_tedarikci_varyant_kodlari_tenant_id_tedarikci_urun_kod_idx" ON "stok_tedarikci_varyant_kodlari"("tenant_id", "tedarikci_urun_kodu");
CREATE UNIQUE INDEX "stok_tedarikci_varyant_kodlari_stok_tedarikci_id_varyant_id_key" ON "stok_tedarikci_varyant_kodlari"("stok_tedarikci_id", "varyant_id");

ALTER TABLE "stok_tedarikci_varyant_kodlari" ADD CONSTRAINT "stok_tedarikci_varyant_kodlari_stok_tedarikci_id_fkey" FOREIGN KEY ("stok_tedarikci_id") REFERENCES "stok_tedarikcileri"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stok_tedarikci_varyant_kodlari" ADD CONSTRAINT "stok_tedarikci_varyant_kodlari_varyant_id_fkey" FOREIGN KEY ("varyant_id") REFERENCES "stok_varyantlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stok_tedarikci_varyant_kodlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stok_tedarikci_varyant_kodlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stok_tedarikci_varyant_kodlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
