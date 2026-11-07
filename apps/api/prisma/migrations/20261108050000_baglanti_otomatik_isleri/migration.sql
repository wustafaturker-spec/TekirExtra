-- PZR-18: pazaryeri bağlantısının otomatik işleri (sipariş, finans, stok/fiyat).
CREATE TABLE "baglanti_otomatik_isleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "baglanti_id" UUID NOT NULL,
    "is" VARCHAR(20) NOT NULL,
    "aralik_dk" INTEGER NOT NULL,
    "son_deneme" TIMESTAMP(3),
    "son_basari" TIMESTAMP(3),
    "ardisik_hata" INTEGER NOT NULL DEFAULT 0,
    "son_hata" TEXT,
    "durdu_nedeni" TEXT,
    "bekleme_carpani" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "baglanti_otomatik_isleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "baglanti_otomatik_isleri_is_check" CHECK ("is" IN ('siparis', 'finans', 'stok_fiyat')),
    CONSTRAINT "baglanti_otomatik_isleri_aralik_check" CHECK ("aralik_dk" >= 0 AND "aralik_dk" <= 1440)
);
CREATE UNIQUE INDEX "baglanti_otomatik_isleri_tenant_id_baglanti_id_is_key" ON "baglanti_otomatik_isleri"("tenant_id", "baglanti_id", "is");
ALTER TABLE "baglanti_otomatik_isleri" ADD CONSTRAINT "baglanti_otomatik_isleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "baglanti_otomatik_isleri" ADD CONSTRAINT "baglanti_otomatik_isleri_baglanti_id_fkey" FOREIGN KEY ("baglanti_id") REFERENCES "baglantilar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "baglanti_otomatik_isleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "baglanti_otomatik_isleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_baglanti_otomatik_isleri ON "baglanti_otomatik_isleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- SEC-17: kiracılar arası bağ denetimi.
CREATE TRIGGER kbag_baglanti_otomatik_isleri_baglanti_id_fkey AFTER INSERT OR UPDATE OF baglanti_id, tenant_id ON "baglanti_otomatik_isleri"
  FOR EACH ROW WHEN (NEW.baglanti_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('baglanti_id', 'baglantilar', 'id');
