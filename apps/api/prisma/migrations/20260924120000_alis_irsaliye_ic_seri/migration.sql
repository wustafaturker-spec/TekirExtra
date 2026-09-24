-- FTR-27: alış irsaliyesi giden e-İrsaliye serisinden (GBZ…) numara alıyordu;
-- o numara hiç gönderilmediği için giden seride boşluk kalıyordu. Alış
-- irsaliyesi artık kendi iç serisinden (AIR + yıl + 6 hane) numaralanır ve
-- tedarikçinin irsaliye numarası ayrı alanda tutulur.
ALTER TABLE "belgeler" ADD COLUMN "tedarikci_belge_no" TEXT;

ALTER TABLE "belge_sayaclari" ADD COLUMN "yon" "BelgeYon" NOT NULL DEFAULT 'satis';
DROP INDEX "belge_sayaclari_tenant_id_tur_yil_key";
CREATE UNIQUE INDEX "belge_sayaclari_tenant_id_tur_yon_yil_key" ON "belge_sayaclari"("tenant_id", "tur", "yon", "yil");

-- Numaralanmış eski alış irsaliyeleri iç seriye taşınır. Harcanmış GBZ
-- numaraları geri alınamaz; satış sayacı olduğu yerden sürer.
WITH "sirali" AS (
  SELECT "id", EXTRACT(YEAR FROM "tarih")::int AS "yil",
         ROW_NUMBER() OVER (PARTITION BY "tenant_id", EXTRACT(YEAR FROM "tarih") ORDER BY "tarih", "created_at", "id") AS "sira"
  FROM "belgeler"
  WHERE "tur" = 'irsaliye' AND "yon" = 'alis' AND "no" IS NOT NULL
)
UPDATE "belgeler" b
SET "no" = 'AIR' || s."yil" || LPAD(s."sira"::text, 6, '0')
FROM "sirali" s
WHERE b."id" = s."id";

INSERT INTO "belge_sayaclari" ("id", "tenant_id", "tur", "yon", "yil", "son_sira")
SELECT gen_random_uuid(), "tenant_id", 'irsaliye', 'alis', EXTRACT(YEAR FROM "tarih")::int, COUNT(*)
FROM "belgeler"
WHERE "tur" = 'irsaliye' AND "yon" = 'alis' AND "no" IS NOT NULL
GROUP BY "tenant_id", EXTRACT(YEAR FROM "tarih");
