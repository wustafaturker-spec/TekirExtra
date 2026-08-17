ALTER TYPE "CekSenetDurum" ADD VALUE IF NOT EXISTS 'tahsile_verildi';
ALTER TYPE "CekSenetDurum" ADD VALUE IF NOT EXISTS 'teminata_verildi';

ALTER TABLE "cek_senetler" ADD COLUMN "fiziksel_konum" TEXT;

CREATE TABLE "cek_senet_olaylari" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "cek_senet_id" UUID NOT NULL,
  "onceki_durum" "CekSenetDurum",
  "yeni_durum" "CekSenetDurum" NOT NULL,
  "islem_tarihi" DATE NOT NULL,
  "aciklama" TEXT,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cek_senet_olaylari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cek_senet_olaylari_cek_senet_id_fkey" FOREIGN KEY ("cek_senet_id") REFERENCES "cek_senetler"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "cek_senet_olaylari_tenant_id_cek_senet_id_created_at_idx"
  ON "cek_senet_olaylari"("tenant_id", "cek_senet_id", "created_at");

INSERT INTO "cek_senet_olaylari" ("id", "tenant_id", "cek_senet_id", "onceki_durum", "yeni_durum", "islem_tarihi", "aciklama", "user_id", "created_at")
SELECT gen_random_uuid(), cs."tenant_id", cs."id", NULL, cs."durum", cs."islem_tarihi", 'Mevcut kayıttan oluşturulan başlangıç geçmişi', u."id", cs."created_at"
FROM "cek_senetler" cs
JOIN LATERAL (
  SELECT "id" FROM "users" WHERE "tenant_id" = cs."tenant_id" ORDER BY "created_at" ASC LIMIT 1
) u ON TRUE;
