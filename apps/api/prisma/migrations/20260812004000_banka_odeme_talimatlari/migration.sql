CREATE TYPE "BankaOdemeTalimatDurumu" AS ENUM ('onay_bekliyor', 'onaylandi', 'gonderildi', 'basarisiz', 'iptal');
CREATE TABLE "banka_odeme_talimatlari" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "banka_hesap_id" UUID NOT NULL,
  "alici_unvan" TEXT NOT NULL, "alici_iban" TEXT NOT NULL, "tutar" DECIMAL(15,2) NOT NULL,
  "doviz_cinsi" "DovizCinsi" NOT NULL, "aciklama" TEXT NOT NULL,
  "durum" "BankaOdemeTalimatDurumu" NOT NULL DEFAULT 'onay_bekliyor',
  "olusturan_user_id" UUID NOT NULL, "onaylayan_user_id" UUID, "onay_zamani" TIMESTAMP(3),
  "saglayici_ref" TEXT, "hata_mesaji" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "banka_odeme_talimatlari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "banka_odeme_talimatlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "banka_odeme_talimatlari_banka_hesap_id_fkey" FOREIGN KEY ("banka_hesap_id") REFERENCES "banka_hesaplari"("id"),
  CONSTRAINT "banka_odeme_talimatlari_olusturan_user_id_fkey" FOREIGN KEY ("olusturan_user_id") REFERENCES "users"("id"),
  CONSTRAINT "banka_odeme_talimatlari_onaylayan_user_id_fkey" FOREIGN KEY ("onaylayan_user_id") REFERENCES "users"("id")
);
CREATE INDEX "banka_odeme_talimatlari_tenant_id_durum_created_at_idx" ON "banka_odeme_talimatlari"("tenant_id", "durum", "created_at");
ALTER TABLE "banka_odeme_talimatlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "banka_odeme_talimatlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "banka_odeme_talimatlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
