-- P1-6: banka POS'u (valör + komisyon önerisi), slip tahsilatı, bağlantı
-- iptali, geç ödeme işareti ve kayıt bazlı POS iadesi.

ALTER TABLE "pos_hesaplari"
  ADD COLUMN "valor_gun" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "komisyon_orani" DECIMAL(5,2) NOT NULL DEFAULT 0;

ALTER TABLE "pos_tahsilatlari"
  ADD COLUMN "kanal" TEXT NOT NULL DEFAULT 'baglanti',
  ADD COLUMN "slip_no" TEXT,
  ADD COLUMN "iptal_nedeni" TEXT,
  ADD COLUMN "gec_odeme" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "pos_iadeleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pos_tahsilat_id" UUID NOT NULL,
    "tutar" DECIMAL(15,2) NOT NULL,
    "tarih" DATE NOT NULL,
    "neden" TEXT NOT NULL,
    "hareket_id" UUID NOT NULL,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pos_iadeleri_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pos_iadeleri_hareket_id_key" ON "pos_iadeleri"("hareket_id");
CREATE INDEX "pos_iadeleri_tenant_id_pos_tahsilat_id_idx" ON "pos_iadeleri"("tenant_id", "pos_tahsilat_id");
ALTER TABLE "pos_iadeleri" ADD CONSTRAINT "pos_iadeleri_pos_tahsilat_id_fkey" FOREIGN KEY ("pos_tahsilat_id") REFERENCES "pos_tahsilatlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_iadeleri" ADD CONSTRAINT "pos_iadeleri_hareket_id_fkey" FOREIGN KEY ("hareket_id") REFERENCES "kasa_banka_hareketleri"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_iadeleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_iadeleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pos_iadeleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
