CREATE TYPE "PazaryeriSiparisDurumu" AS ENUM ('yeni', 'esleme_bekliyor', 'faturalanmaya_hazir', 'faturalandi', 'iptal', 'hata');

CREATE TABLE "pazaryeri_siparisleri" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "baglanti_id" UUID NOT NULL,
  "harici_id" TEXT NOT NULL, "siparis_no" TEXT NOT NULL,
  "durum" "PazaryeriSiparisDurumu" NOT NULL DEFAULT 'yeni', "harici_durum" TEXT,
  "siparis_tarihi" TIMESTAMP(3) NOT NULL, "musteri_unvani" TEXT NOT NULL,
  "musteri_eposta" TEXT, "musteri_telefon" TEXT, "vkn_tckn" TEXT,
  "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY', "toplam" DECIMAL(15,2) NOT NULL,
  "teslimat_adresi" JSONB, "ham_veri" JSONB, "cari_id" UUID, "fatura_id" UUID,
  "hata_mesaji" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pazaryeri_siparisleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pazaryeri_siparisleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pazaryeri_siparisleri_baglanti_id_fkey" FOREIGN KEY ("baglanti_id") REFERENCES "baglantilar"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pazaryeri_siparisleri_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pazaryeri_siparisleri_fatura_id_fkey" FOREIGN KEY ("fatura_id") REFERENCES "faturalar"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "pazaryeri_siparis_satirlari" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "siparis_id" UUID NOT NULL,
  "harici_satir_id" TEXT NOT NULL, "sku" TEXT NOT NULL, "barkod" TEXT,
  "urun_adi" TEXT NOT NULL, "miktar" DECIMAL(15,4) NOT NULL,
  "birim_fiyat" DECIMAL(15,6) NOT NULL, "kdv_orani" DECIMAL(5,2) NOT NULL DEFAULT 20,
  "stok_id" UUID, "varyant_id" UUID, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pazaryeri_siparis_satirlari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pazaryeri_siparis_satirlari_siparis_id_fkey" FOREIGN KEY ("siparis_id") REFERENCES "pazaryeri_siparisleri"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pazaryeri_siparis_satirlari_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pazaryeri_siparis_satirlari_varyant_id_fkey" FOREIGN KEY ("varyant_id") REFERENCES "stok_varyantlari"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "pazaryeri_siparisleri_tenant_id_baglanti_id_harici_id_key" ON "pazaryeri_siparisleri"("tenant_id", "baglanti_id", "harici_id");
CREATE INDEX "pazaryeri_siparisleri_tenant_id_durum_siparis_tarihi_idx" ON "pazaryeri_siparisleri"("tenant_id", "durum", "siparis_tarihi");
CREATE UNIQUE INDEX "pazaryeri_siparis_satirlari_siparis_id_harici_satir_id_key" ON "pazaryeri_siparis_satirlari"("siparis_id", "harici_satir_id");
CREATE INDEX "pazaryeri_siparis_satirlari_tenant_id_stok_id_idx" ON "pazaryeri_siparis_satirlari"("tenant_id", "stok_id");

ALTER TABLE "pazaryeri_siparisleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pazaryeri_siparisleri" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pazaryeri_siparis_satirlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pazaryeri_siparis_satirlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_pazaryeri_siparisleri ON "pazaryeri_siparisleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation_pazaryeri_siparis_satirlari ON "pazaryeri_siparis_satirlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
