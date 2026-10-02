-- KSB-10: kredi kartı dönem ekstresi, asgari ödeme ve kart kaynaklı giderler.

ALTER TABLE "kredi_kartlari" ADD COLUMN "asgari_odeme_orani" DECIMAL(5,2);

CREATE TABLE "kredi_karti_ekstreleri" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kredi_karti_id" UUID NOT NULL,
    "kesim_tarihi" DATE NOT NULL,
    "son_odeme_tarihi" DATE NOT NULL,
    "hesaplanan_tutar" DECIMAL(15,2) NOT NULL,
    "banka_tutari" DECIMAL(15,2) NOT NULL,
    "banka_asgari_tutari" DECIMAL(15,2),
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kredi_karti_ekstreleri_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kredi_karti_ekstreleri_kredi_karti_id_kesim_tarihi_key" ON "kredi_karti_ekstreleri"("kredi_karti_id", "kesim_tarihi");
CREATE INDEX "kredi_karti_ekstreleri_tenant_id_kredi_karti_id_idx" ON "kredi_karti_ekstreleri"("tenant_id", "kredi_karti_id");
ALTER TABLE "kredi_karti_ekstreleri" ADD CONSTRAINT "kredi_karti_ekstreleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kredi_karti_ekstreleri" ADD CONSTRAINT "kredi_karti_ekstreleri_kredi_karti_id_fkey" FOREIGN KEY ("kredi_karti_id") REFERENCES "kredi_kartlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "kredi_karti_ekstreleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kredi_karti_ekstreleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "kredi_karti_ekstreleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "kredi_karti_taksitleri" ADD COLUMN "ekstre_id" UUID;
ALTER TABLE "kredi_karti_taksitleri" ADD CONSTRAINT "kredi_karti_taksitleri_ekstre_id_fkey" FOREIGN KEY ("ekstre_id") REFERENCES "kredi_karti_ekstreleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kredi_karti_hareketleri" ADD COLUMN "ekstre_id" UUID;
ALTER TABLE "kredi_karti_hareketleri" ADD CONSTRAINT "kredi_karti_hareketleri_ekstre_id_fkey" FOREIGN KEY ("ekstre_id") REFERENCES "kredi_karti_ekstreleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "masraflar" ADD COLUMN "kaynak_tur" TEXT NOT NULL DEFAULT 'manuel';
