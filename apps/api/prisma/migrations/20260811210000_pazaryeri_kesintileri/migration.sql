CREATE TYPE "PazaryeriKesintiDurumu" AS ENUM ('bekliyor', 'giderlesti');

ALTER TABLE "baglantilar" ADD COLUMN "kesinti_senkron_imleci" TEXT;

CREATE TABLE "pazaryeri_kesintileri" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "baglanti_id" UUID NOT NULL,
  "harici_id" TEXT NOT NULL, "siparis_no" TEXT, "tur" TEXT NOT NULL, "aciklama" TEXT,
  "tarih" DATE NOT NULL, "tutar" DECIMAL(15,2) NOT NULL,
  "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
  "durum" "PazaryeriKesintiDurumu" NOT NULL DEFAULT 'bekliyor', "hareket_id" UUID,
  "ham_veri" JSONB, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pazaryeri_kesintileri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pazaryeri_kesintileri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pazaryeri_kesintileri_baglanti_id_fkey" FOREIGN KEY ("baglanti_id") REFERENCES "baglantilar"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pazaryeri_kesintileri_hareket_id_fkey" FOREIGN KEY ("hareket_id") REFERENCES "kasa_banka_hareketleri"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "pazaryeri_kesintileri_tenant_id_baglanti_id_harici_id_key" ON "pazaryeri_kesintileri"("tenant_id", "baglanti_id", "harici_id");
CREATE UNIQUE INDEX "pazaryeri_kesintileri_hareket_id_key" ON "pazaryeri_kesintileri"("hareket_id");
CREATE INDEX "pazaryeri_kesintileri_tenant_id_durum_tarih_idx" ON "pazaryeri_kesintileri"("tenant_id", "durum", "tarih");
ALTER TABLE "pazaryeri_kesintileri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pazaryeri_kesintileri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_pazaryeri_kesintileri ON "pazaryeri_kesintileri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
