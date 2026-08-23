CREATE TYPE "PersonelBordroDurum" AS ENUM ('hesaplandi', 'onay_bekliyor', 'onaylandi', 'reddedildi', 'odendi', 'iptal');
CREATE TYPE "PersonelBordroKalemTipi" AS ENUM ('kazanc', 'kesinti');

ALTER TABLE "personel_bordro"
ADD COLUMN "durum" "PersonelBordroDurum" NOT NULL DEFAULT 'hesaplandi',
ADD COLUMN "olusturan_user_id" UUID,
ADD COLUMN "onaylayan_user_id" UUID,
ADD COLUMN "onay_tarihi" TIMESTAMP(3),
ADD COLUMN "ret_nedeni" TEXT;

UPDATE "personel_bordro" SET "durum" = CASE WHEN "odendi" THEN 'odendi'::"PersonelBordroDurum" ELSE 'hesaplandi'::"PersonelBordroDurum" END;

CREATE TABLE "personel_bordro_kalemleri" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "bordro_id" UUID NOT NULL,
  "tip" "PersonelBordroKalemTipi" NOT NULL,
  "kod" TEXT NOT NULL,
  "aciklama" TEXT NOT NULL,
  "tutar" DECIMAL(15,2) NOT NULL,
  "manuel" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personel_bordro_kalemleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personel_bordro_kalemleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personel_bordro_kalemleri_bordro_id_fkey" FOREIGN KEY ("bordro_id") REFERENCES "personel_bordro"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "personel_bordro_kalemleri_tenant_id_bordro_id_idx" ON "personel_bordro_kalemleri"("tenant_id", "bordro_id");
INSERT INTO "personel_bordro_kalemleri" ("id", "tenant_id", "bordro_id", "tip", "kod", "aciklama", "tutar")
SELECT gen_random_uuid(), "tenant_id", "id", 'kazanc', 'temel_ucret', 'Temel ücret', "net_maas" FROM "personel_bordro";

ALTER TABLE "personel_bordro_kalemleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personel_bordro_kalemleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_personel_bordro_kalemleri" ON "personel_bordro_kalemleri"
USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
