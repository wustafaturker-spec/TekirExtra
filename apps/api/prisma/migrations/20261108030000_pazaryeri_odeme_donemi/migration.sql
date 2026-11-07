-- PZR-16: pazaryeri ödeme dönemi (Trendyol payment-order) ve sipariş/kesintide ödeme numarası.
ALTER TABLE "pazaryeri_siparisleri" ADD COLUMN "odeme_no" TEXT;
ALTER TABLE "pazaryeri_kesintileri" ADD COLUMN "odeme_no" TEXT;
CREATE INDEX "pazaryeri_siparisleri_tenant_id_baglanti_id_odeme_no_idx" ON "pazaryeri_siparisleri"("tenant_id", "baglanti_id", "odeme_no");
CREATE INDEX "pazaryeri_kesintileri_tenant_id_baglanti_id_odeme_no_idx" ON "pazaryeri_kesintileri"("tenant_id", "baglanti_id", "odeme_no");

CREATE TABLE "pazaryeri_odeme_donemleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "baglanti_id" UUID NOT NULL,
    "harici_id" TEXT NOT NULL,
    "tutar" DECIMAL(15,2) NOT NULL,
    "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
    "odeme_tarihi" TIMESTAMP(3) NOT NULL,
    "durum" TEXT,
    "kalemler_alindi_at" TIMESTAMP(3),
    "siparis_sayisi" INTEGER NOT NULL DEFAULT 0,
    "kesinti_sayisi" INTEGER NOT NULL DEFAULT 0,
    "ham_veri" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pazaryeri_odeme_donemleri_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pazaryeri_odeme_donemleri_tenant_id_baglanti_id_harici_id_key" ON "pazaryeri_odeme_donemleri"("tenant_id", "baglanti_id", "harici_id");
CREATE INDEX "pazaryeri_odeme_donemleri_tenant_id_baglanti_id_odeme_tarihi_idx" ON "pazaryeri_odeme_donemleri"("tenant_id", "baglanti_id", "odeme_tarihi");
ALTER TABLE "pazaryeri_odeme_donemleri" ADD CONSTRAINT "pazaryeri_odeme_donemleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pazaryeri_odeme_donemleri" ADD CONSTRAINT "pazaryeri_odeme_donemleri_baglanti_id_fkey" FOREIGN KEY ("baglanti_id") REFERENCES "baglantilar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pazaryeri_odeme_donemleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pazaryeri_odeme_donemleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_pazaryeri_odeme_donemleri ON "pazaryeri_odeme_donemleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- SEC-17: kiracılar arası bağ denetimi.
CREATE TRIGGER kbag_pazaryeri_odeme_donemleri_baglanti_id_fkey AFTER INSERT OR UPDATE OF baglanti_id, tenant_id ON "pazaryeri_odeme_donemleri"
  FOR EACH ROW WHEN (NEW.baglanti_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('baglanti_id', 'baglantilar', 'id');
