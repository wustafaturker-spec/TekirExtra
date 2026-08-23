CREATE TYPE "PersonelDurum" AS ENUM ('taslak', 'aktif', 'askida', 'uzun_sureli_izin', 'isten_ayrildi');

ALTER TABLE "personel"
ADD COLUMN "personel_no" TEXT,
ADD COLUMN "durum" "PersonelDurum" NOT NULL DEFAULT 'aktif',
ADD COLUMN "ayrilis_nedeni" TEXT;

-- Mevcut kayıtlar tenant içinde oluşturulma sırasına göre deterministik numaralanır.
WITH numarali AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS sira
  FROM "personel"
)
UPDATE "personel" p
SET "personel_no" = 'PRS-' || lpad(numarali.sira::text, 6, '0')
FROM numarali
WHERE p.id = numarali.id;

UPDATE "personel"
SET "durum" = CASE
  WHEN "aktif" = false OR "cikis_tarihi" IS NOT NULL THEN 'isten_ayrildi'::"PersonelDurum"
  ELSE 'aktif'::"PersonelDurum"
END;

ALTER TABLE "personel" ALTER COLUMN "personel_no" SET NOT NULL;
CREATE UNIQUE INDEX "personel_tenant_id_personel_no_key" ON "personel"("tenant_id", "personel_no");

CREATE TABLE "personel_istihdam_donemleri" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "personel_id" UUID NOT NULL,
  "baslangic_tarihi" DATE NOT NULL,
  "bitis_tarihi" DATE,
  "ayrilis_nedeni" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personel_istihdam_donemleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personel_istihdam_donemleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personel_istihdam_donemleri_personel_id_fkey" FOREIGN KEY ("personel_id") REFERENCES "personel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "personel_istihdam_donemleri_tenant_id_personel_id_baslangic_tarihi_idx" ON "personel_istihdam_donemleri"("tenant_id", "personel_id", "baslangic_tarihi");
INSERT INTO "personel_istihdam_donemleri" ("id", "tenant_id", "personel_id", "baslangic_tarihi", "bitis_tarihi", "ayrilis_nedeni")
SELECT gen_random_uuid(), "tenant_id", "id", "giris_tarihi", "cikis_tarihi", "ayrilis_nedeni" FROM "personel";
ALTER TABLE "personel_istihdam_donemleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personel_istihdam_donemleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_personel_istihdam" ON "personel_istihdam_donemleri"
USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE "personel_sayaclari" (
  "tenant_id" UUID NOT NULL,
  "son_sira" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "personel_sayaclari_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "personel_sayaclari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "personel_sayaclari" ("tenant_id", "son_sira")
SELECT "tenant_id", count(*)::integer FROM "personel" GROUP BY "tenant_id";

ALTER TABLE "personel_sayaclari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personel_sayaclari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_personel_sayaclari" ON "personel_sayaclari"
USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
