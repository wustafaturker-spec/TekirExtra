-- STK-07 Çoklu depo.
-- Sıra önemlidir: tablolar oluşturulur → varsayılan depo açılıp mevcut veri
-- taşınır → NOT NULL/FK konur → en sonda RLS açılır (RLS FORCE tablo sahibini
-- de bağladığı için göç verisi RLS'ten önce yazılmalıdır).

-- CreateEnum
CREATE TYPE "TransferDurum" AS ENUM ('taslak', 'onaylandi');

-- AlterEnum
ALTER TYPE "StokHareketTip" ADD VALUE 'transfer_cikis';
ALTER TYPE "StokHareketTip" ADD VALUE 'transfer_giris';

-- CreateTable
CREATE TABLE "depolar" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kod" TEXT NOT NULL,
    "ad" TEXT NOT NULL,
    "adres" TEXT,
    "sorumlu" TEXT,
    "varsayilan" BOOLEAN NOT NULL DEFAULT false,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "depolar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stok_depo_bakiyeleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stok_id" UUID NOT NULL,
    "depo_id" UUID NOT NULL,
    "mevcut_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "rezerve_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "yoldaki_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,

    CONSTRAINT "stok_depo_bakiyeleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depo_transferleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "no" TEXT NOT NULL,
    "tarih" DATE NOT NULL,
    "kaynak_depo_id" UUID NOT NULL,
    "hedef_depo_id" UUID NOT NULL,
    "aciklama" TEXT,
    "durum" "TransferDurum" NOT NULL DEFAULT 'taslak',
    "onaylayan_user_id" UUID,
    "onay_zamani" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "depo_transferleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depo_transfer_kalemleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "stok_id" UUID NOT NULL,
    "miktar" DECIMAL(15,3) NOT NULL,
    "girilen_birim" TEXT NOT NULL,
    "girilen_miktar" DECIMAL(15,3) NOT NULL,

    CONSTRAINT "depo_transfer_kalemleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_sayaclari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "yil" INTEGER NOT NULL,
    "son_sira" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "transfer_sayaclari_pkey" PRIMARY KEY ("id")
);

-- AlterTable: depo alanları önce boş kabul eder, göçten sonra NOT NULL olur
ALTER TABLE "stok_hareketleri" ADD COLUMN "depo_id" UUID;
ALTER TABLE "sayimlar" ADD COLUMN "depo_id" UUID;
ALTER TABLE "faturalar" ADD COLUMN "depo_id" UUID;
ALTER TABLE "belgeler" ADD COLUMN "depo_id" UUID;

-- ─── Veri göçü (K-03: bugüne dek tek depo varsayımıyla çalışıldı) ───────────

-- Her kiracıya varsayılan "Merkez Depo"
INSERT INTO "depolar" ("id", "tenant_id", "kod", "ad", "varsayilan", "aktif", "created_at", "updated_at")
SELECT gen_random_uuid(), t."id", 'MERKEZ', 'Merkez Depo', true, true, now(), now()
FROM "tenants" t;

-- Mevcut hareket ve sayımlar merkez depoya bağlanır
UPDATE "stok_hareketleri" h
SET "depo_id" = d."id"
FROM "depolar" d
WHERE d."tenant_id" = h."tenant_id" AND d."varsayilan" = true;

UPDATE "sayimlar" s
SET "depo_id" = d."id"
FROM "depolar" d
WHERE d."tenant_id" = s."tenant_id" AND d."varsayilan" = true;

-- Kartlardaki bakiye merkez deponun bakiyesi olur (kart alanı toplam olarak kalır)
INSERT INTO "stok_depo_bakiyeleri" ("id", "tenant_id", "stok_id", "depo_id", "mevcut_miktar", "rezerve_miktar", "yoldaki_miktar")
SELECT gen_random_uuid(), k."tenant_id", k."id", d."id", k."mevcut_miktar", k."rezerve_miktar", k."yoldaki_miktar"
FROM "stok_kartlari" k
JOIN "depolar" d ON d."tenant_id" = k."tenant_id" AND d."varsayilan" = true;

-- Göç tamamlandı: alanlar zorunlu
ALTER TABLE "stok_hareketleri" ALTER COLUMN "depo_id" SET NOT NULL;
ALTER TABLE "sayimlar" ALTER COLUMN "depo_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "depolar_tenant_id_idx" ON "depolar"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "depolar_tenant_id_kod_key" ON "depolar"("tenant_id", "kod");

-- CreateIndex
CREATE INDEX "stok_depo_bakiyeleri_tenant_id_depo_id_idx" ON "stok_depo_bakiyeleri"("tenant_id", "depo_id");

-- CreateIndex
CREATE UNIQUE INDEX "stok_depo_bakiyeleri_tenant_id_stok_id_depo_id_key" ON "stok_depo_bakiyeleri"("tenant_id", "stok_id", "depo_id");

-- CreateIndex
CREATE INDEX "depo_transferleri_tenant_id_durum_idx" ON "depo_transferleri"("tenant_id", "durum");

-- CreateIndex
CREATE UNIQUE INDEX "depo_transferleri_tenant_id_no_key" ON "depo_transferleri"("tenant_id", "no");

-- CreateIndex
CREATE INDEX "depo_transfer_kalemleri_tenant_id_transfer_id_idx" ON "depo_transfer_kalemleri"("tenant_id", "transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_sayaclari_tenant_id_yil_key" ON "transfer_sayaclari"("tenant_id", "yil");

-- CreateIndex
CREATE INDEX "stok_hareketleri_tenant_id_depo_id_tarih_idx" ON "stok_hareketleri"("tenant_id", "depo_id", "tarih");

-- CreateIndex
CREATE INDEX "sayimlar_tenant_id_depo_id_idx" ON "sayimlar"("tenant_id", "depo_id");

-- AddForeignKey
ALTER TABLE "stok_hareketleri" ADD CONSTRAINT "stok_hareketleri_depo_id_fkey" FOREIGN KEY ("depo_id") REFERENCES "depolar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sayimlar" ADD CONSTRAINT "sayimlar_depo_id_fkey" FOREIGN KEY ("depo_id") REFERENCES "depolar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stok_depo_bakiyeleri" ADD CONSTRAINT "stok_depo_bakiyeleri_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stok_depo_bakiyeleri" ADD CONSTRAINT "stok_depo_bakiyeleri_depo_id_fkey" FOREIGN KEY ("depo_id") REFERENCES "depolar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depo_transferleri" ADD CONSTRAINT "depo_transferleri_kaynak_depo_id_fkey" FOREIGN KEY ("kaynak_depo_id") REFERENCES "depolar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depo_transferleri" ADD CONSTRAINT "depo_transferleri_hedef_depo_id_fkey" FOREIGN KEY ("hedef_depo_id") REFERENCES "depolar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depo_transfer_kalemleri" ADD CONSTRAINT "depo_transfer_kalemleri_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "depo_transferleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depo_transfer_kalemleri" ADD CONSTRAINT "depo_transfer_kalemleri_stok_id_fkey" FOREIGN KEY ("stok_id") REFERENCES "stok_kartlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faturalar" ADD CONSTRAINT "faturalar_depo_id_fkey" FOREIGN KEY ("depo_id") REFERENCES "depolar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "belgeler" ADD CONSTRAINT "belgeler_depo_id_fkey" FOREIGN KEY ("depo_id") REFERENCES "depolar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Kiracı yalıtımı (KLN-06): depo tabloları
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['depolar','stok_depo_bakiyeleri','depo_transferleri','depo_transfer_kalemleri','transfer_sayaclari'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t);
  END LOOP;
END
$$;
