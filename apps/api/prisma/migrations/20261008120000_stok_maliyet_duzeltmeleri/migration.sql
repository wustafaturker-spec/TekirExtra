-- STK-28: maliyeti yeniden hesaplama. Stok hareketleri değişmez kayıt kalır
-- (NFR-08); uygulama rolü yalnız `maliyet` sütununu güncelleyebilir ve her
-- değişiklik eski/yeni değeriyle yalnız-eklemeli geçmişe yazılır.
GRANT UPDATE ("maliyet") ON TABLE "stok_hareketleri" TO tekir_app;

CREATE TABLE "stok_maliyet_duzeltmeleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "hareket_id" UUID NOT NULL,
    "calisma_id" UUID NOT NULL,
    "eski_maliyet" DECIMAL(15,4) NOT NULL,
    "yeni_maliyet" DECIMAL(15,4) NOT NULL,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stok_maliyet_duzeltmeleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stok_maliyet_duzeltmeleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stok_maliyet_duzeltmeleri_hareket_id_fkey" FOREIGN KEY ("hareket_id") REFERENCES "stok_hareketleri"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "stok_maliyet_duzeltmeleri_tenant_id_hareket_id_idx" ON "stok_maliyet_duzeltmeleri"("tenant_id", "hareket_id");
CREATE INDEX "stok_maliyet_duzeltmeleri_tenant_id_calisma_id_idx" ON "stok_maliyet_duzeltmeleri"("tenant_id", "calisma_id");
ALTER TABLE "stok_maliyet_duzeltmeleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stok_maliyet_duzeltmeleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stok_maliyet_duzeltmeleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
REVOKE UPDATE, DELETE ON TABLE "stok_maliyet_duzeltmeleri" FROM tekir_app;
