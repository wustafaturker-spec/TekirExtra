ALTER TYPE "MasrafOdemeDurumu" ADD VALUE IF NOT EXISTS 'kismi_odendi';

ALTER TABLE "masraflar"
ADD COLUMN "odenen_tutar" DECIMAL(15,2) NOT NULL DEFAULT 0;

UPDATE "masraflar"
SET "odenen_tutar" = GREATEST("toplam" - COALESCE("stopaj_tutari", 0), 0)
WHERE "odeme_durumu" = 'odendi';

CREATE TABLE "masraf_odemeleri" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "masraf_id" UUID NOT NULL,
  "kasa_id" UUID,
  "banka_hesap_id" UUID,
  "hareket_id" UUID NOT NULL,
  "tutar" DECIMAL(15,2) NOT NULL,
  "odeme_tarihi" DATE NOT NULL,
  "aciklama" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "masraf_odemeleri_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "masraf_odemeleri_hareket_id_key" ON "masraf_odemeleri"("hareket_id");
CREATE INDEX "masraf_odemeleri_tenant_id_masraf_id_odeme_tarihi_idx" ON "masraf_odemeleri"("tenant_id", "masraf_id", "odeme_tarihi");
ALTER TABLE "masraf_odemeleri" ADD CONSTRAINT "masraf_odemeleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "masraf_odemeleri" ADD CONSTRAINT "masraf_odemeleri_masraf_id_fkey" FOREIGN KEY ("masraf_id") REFERENCES "masraflar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "masraf_odemeleri" ADD CONSTRAINT "masraf_odemeleri_kasa_id_fkey" FOREIGN KEY ("kasa_id") REFERENCES "kasalar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "masraf_odemeleri" ADD CONSTRAINT "masraf_odemeleri_banka_hesap_id_fkey" FOREIGN KEY ("banka_hesap_id") REFERENCES "banka_hesaplari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
