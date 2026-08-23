ALTER TYPE "PersonelBordroDurum" ADD VALUE 'kismen_odendi' AFTER 'onaylandi';
CREATE TYPE "PersonelBordroOdemeDurum" AS ENUM ('aktif', 'iptal');
ALTER TABLE "personel_bordro"
ADD COLUMN "odenen_tutar" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN "kalan_tutar" DECIMAL(15,2) NOT NULL DEFAULT 0;
UPDATE "personel_bordro" SET
  "odenen_tutar" = CASE WHEN "odendi" THEN "odenecek_tutar" ELSE 0 END,
  "kalan_tutar" = CASE WHEN "odendi" THEN 0 ELSE "odenecek_tutar" END;

CREATE TABLE "personel_bordro_odemeleri" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "bordro_id" UUID NOT NULL,
  "tutar" DECIMAL(15,2) NOT NULL, "tarih" DATE NOT NULL, "kasa_id" UUID,
  "banka_hesap_id" UUID, "aciklama" TEXT,
  "durum" "PersonelBordroOdemeDurum" NOT NULL DEFAULT 'aktif',
  "kasa_banka_hareket_id" UUID, "cari_hareket_id" UUID,
  "iptal_tarihi" TIMESTAMP(3), "iptal_nedeni" TEXT,
  "ters_kasa_banka_hareket_id" UUID, "ters_cari_hareket_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personel_bordro_odemeleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personel_bordro_odemeleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personel_bordro_odemeleri_bordro_id_fkey" FOREIGN KEY ("bordro_id") REFERENCES "personel_bordro"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personel_bordro_odemeleri_tek_kaynak_check" CHECK (("kasa_id" IS NOT NULL) <> ("banka_hesap_id" IS NOT NULL)),
  CONSTRAINT "personel_bordro_odemeleri_tutar_check" CHECK ("tutar" > 0)
);
CREATE INDEX "personel_bordro_odemeleri_tenant_id_bordro_id_tarih_idx" ON "personel_bordro_odemeleri"("tenant_id", "bordro_id", "tarih");
INSERT INTO "personel_bordro_odemeleri" ("id", "tenant_id", "bordro_id", "tutar", "tarih", "aciklama", "kasa_banka_hareket_id", "kasa_id", "banka_hesap_id")
SELECT gen_random_uuid(), b."tenant_id", b."id", b."odenecek_tutar", COALESCE(b."odeme_tarihi"::date, CURRENT_DATE), 'Geçmiş bordro ödemesi', b."kasa_banka_fis_id", h."kasa_id", h."banka_hesap_id"
FROM "personel_bordro" b JOIN "kasa_banka_hareketleri" h ON h."id" = b."kasa_banka_fis_id" WHERE b."odendi" = true;
ALTER TABLE "personel_bordro_odemeleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personel_bordro_odemeleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_personel_bordro_odemeleri" ON "personel_bordro_odemeleri"
USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
