ALTER TABLE "kredi_karti_hareketleri"
  ADD COLUMN "cari_odeme_tutari" DECIMAL(15,2),
  ADD COLUMN "komisyon_tutari" DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN "ilk_taksit_tarihi" DATE,
  ADD COLUMN "cari_id" UUID,
  ADD COLUMN "fatura_id" UUID,
  ADD COLUMN "banka_hareket_id" UUID;

CREATE TABLE "kredi_karti_taksitleri" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "hareket_id" UUID NOT NULL,
  "sira" INTEGER NOT NULL,
  "vade_tarihi" DATE NOT NULL,
  "tutar" DECIMAL(15,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kredi_karti_taksitleri_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kredi_karti_hareketleri_banka_hareket_id_key" ON "kredi_karti_hareketleri"("banka_hareket_id");
CREATE INDEX "kredi_karti_hareketleri_tenant_id_cari_id_idx" ON "kredi_karti_hareketleri"("tenant_id", "cari_id");
CREATE INDEX "kredi_karti_hareketleri_tenant_id_fatura_id_idx" ON "kredi_karti_hareketleri"("tenant_id", "fatura_id");
CREATE UNIQUE INDEX "kredi_karti_taksitleri_hareket_id_sira_key" ON "kredi_karti_taksitleri"("hareket_id", "sira");
CREATE INDEX "kredi_karti_taksitleri_tenant_id_vade_tarihi_idx" ON "kredi_karti_taksitleri"("tenant_id", "vade_tarihi");

ALTER TABLE "kredi_karti_hareketleri" ADD CONSTRAINT "kredi_karti_hareketleri_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kredi_karti_hareketleri" ADD CONSTRAINT "kredi_karti_hareketleri_fatura_id_fkey" FOREIGN KEY ("fatura_id") REFERENCES "faturalar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kredi_karti_hareketleri" ADD CONSTRAINT "kredi_karti_hareketleri_banka_hareket_id_fkey" FOREIGN KEY ("banka_hareket_id") REFERENCES "kasa_banka_hareketleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kredi_karti_taksitleri" ADD CONSTRAINT "kredi_karti_taksitleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kredi_karti_taksitleri" ADD CONSTRAINT "kredi_karti_taksitleri_hareket_id_fkey" FOREIGN KEY ("hareket_id") REFERENCES "kredi_karti_hareketleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;
