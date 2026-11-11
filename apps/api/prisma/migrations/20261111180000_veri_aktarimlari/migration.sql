-- VAK-07: veri aktarım sihirbazının partileri; geri alma oluşturulan kayıt kimliklerinden yapılır.
CREATE TABLE "veri_aktarimlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "adim" VARCHAR(20) NOT NULL,
    "dosya_adi" VARCHAR(255) NOT NULL,
    "ozet" JSONB NOT NULL,
    "olusturulanlar" JSONB NOT NULL,
    "kullanici_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "geri_alindi_at" TIMESTAMP(3),
    "geri_alan_id" UUID,
    CONSTRAINT "veri_aktarimlari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "veri_aktarimlari_adim_check" CHECK ("adim" IN ('cari', 'stok', 'acilis_stok', 'kasa_banka', 'acik_fatura'))
);
CREATE INDEX "veri_aktarimlari_tenant_id_created_at_idx" ON "veri_aktarimlari"("tenant_id", "created_at");
ALTER TABLE "veri_aktarimlari" ADD CONSTRAINT "veri_aktarimlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "veri_aktarimlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "veri_aktarimlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_veri_aktarimlari ON "veri_aktarimlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
