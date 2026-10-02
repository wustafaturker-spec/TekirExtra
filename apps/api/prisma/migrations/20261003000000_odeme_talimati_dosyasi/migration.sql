-- ENT-07: ödeme talimatının cari/fatura bağı, ödeme paketi ve toplu ödeme dosyası.

ALTER TYPE "BankaOdemeTalimatDurumu" ADD VALUE 'gerceklesti';
ALTER TYPE "EkstreEslesmeTuru" ADD VALUE 'odeme_talimati';

ALTER TABLE "banka_hesaplari" ADD COLUMN "odeme_dosya_profili" JSONB;

CREATE TABLE "odeme_paketleri" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "no" TEXT NOT NULL,
    "banka_hesap_id" UUID NOT NULL,
    "dosya_bicimi" TEXT NOT NULL,
    "toplam" DECIMAL(15,2) NOT NULL,
    "adet" INTEGER NOT NULL,
    "indirme_sayisi" INTEGER NOT NULL DEFAULT 0,
    "son_indirme" TIMESTAMP(3),
    "iptal" BOOLEAN NOT NULL DEFAULT false,
    "olusturan_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "odeme_paketleri_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "odeme_paketleri_tenant_id_no_key" ON "odeme_paketleri"("tenant_id", "no");
ALTER TABLE "odeme_paketleri" ADD CONSTRAINT "odeme_paketleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "odeme_paketleri" ADD CONSTRAINT "odeme_paketleri_banka_hesap_id_fkey" FOREIGN KEY ("banka_hesap_id") REFERENCES "banka_hesaplari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "banka_odeme_talimatlari" ADD COLUMN "no" TEXT,
ADD COLUMN "cari_id" UUID,
ADD COLUMN "cari_banka_hesap_id" UUID,
ADD COLUMN "odeme_tarihi" DATE NOT NULL DEFAULT CURRENT_DATE,
ADD COLUMN "paket_id" UUID,
ADD COLUMN "gerceklesme_tarihi" DATE;
CREATE UNIQUE INDEX "banka_odeme_talimatlari_tenant_id_no_key" ON "banka_odeme_talimatlari"("tenant_id", "no");
ALTER TABLE "banka_odeme_talimatlari" ADD CONSTRAINT "banka_odeme_talimatlari_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "banka_odeme_talimatlari" ADD CONSTRAINT "banka_odeme_talimatlari_paket_id_fkey" FOREIGN KEY ("paket_id") REFERENCES "odeme_paketleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "banka_odeme_talimati_faturalari" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "talimat_id" UUID NOT NULL,
    "fatura_id" UUID NOT NULL,
    "tutar" DECIMAL(15,2) NOT NULL,
    CONSTRAINT "banka_odeme_talimati_faturalari_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "banka_odeme_talimati_faturalari_talimat_id_fatura_id_key" ON "banka_odeme_talimati_faturalari"("talimat_id", "fatura_id");
CREATE INDEX "banka_odeme_talimati_faturalari_tenant_id_fatura_id_idx" ON "banka_odeme_talimati_faturalari"("tenant_id", "fatura_id");
ALTER TABLE "banka_odeme_talimati_faturalari" ADD CONSTRAINT "banka_odeme_talimati_faturalari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "banka_odeme_talimati_faturalari" ADD CONSTRAINT "banka_odeme_talimati_faturalari_talimat_id_fkey" FOREIGN KEY ("talimat_id") REFERENCES "banka_odeme_talimatlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "banka_odeme_talimati_faturalari" ADD CONSTRAINT "banka_odeme_talimati_faturalari_fatura_id_fkey" FOREIGN KEY ("fatura_id") REFERENCES "faturalar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "numara_sayaclari" (
    "tenant_id" UUID NOT NULL,
    "tur" TEXT NOT NULL,
    "yil" INTEGER NOT NULL,
    "son_sira" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "numara_sayaclari_pkey" PRIMARY KEY ("tenant_id", "tur", "yil")
);
ALTER TABLE "numara_sayaclari" ADD CONSTRAINT "numara_sayaclari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "odeme_paketleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "odeme_paketleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "odeme_paketleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "banka_odeme_talimati_faturalari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "banka_odeme_talimati_faturalari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "banka_odeme_talimati_faturalari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "numara_sayaclari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "numara_sayaclari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "numara_sayaclari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
