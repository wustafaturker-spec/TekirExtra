-- KSB-06: ekstre eşleme türleri, satırdan hareketlere bire-çok bağ, eşleme kuralları.
CREATE TYPE "EkstreEslesmeTuru" AS ENUM ('cari', 'mevcut_fis', 'masraf', 'gelir', 'virman', 'cek', 'kredi_karti', 'pos');
CREATE TYPE "EkstreKuralYonu" AS ENUM ('giris', 'cikis');

-- Bağ yön değiştirir: satır.hareket_id yerine hareket.ekstre_satir_id (bir satıra çok hareket).
ALTER TABLE "kasa_banka_hareketleri" ADD COLUMN "ekstre_satir_id" UUID;
UPDATE "kasa_banka_hareketleri" h SET "ekstre_satir_id" = s."id"
FROM "banka_ekstre_satirlari" s WHERE s."hareket_id" = h."id";

ALTER TABLE "banka_ekstre_satirlari" ADD COLUMN "eslesme_turu" "EkstreEslesmeTuru";
UPDATE "banka_ekstre_satirlari" s SET "eslesme_turu" = CASE WHEN h."kaynak_tur" = 'pos_mutabakat' THEN 'pos'::"EkstreEslesmeTuru" ELSE 'cari'::"EkstreEslesmeTuru" END
FROM "kasa_banka_hareketleri" h WHERE s."hareket_id" = h."id" AND s."durum" = 'eslesti';

ALTER TABLE "banka_ekstre_satirlari" DROP CONSTRAINT "banka_ekstre_satirlari_hareket_id_fkey";
DROP INDEX "banka_ekstre_satirlari_hareket_id_key";
ALTER TABLE "banka_ekstre_satirlari" DROP COLUMN "hareket_id";

CREATE INDEX "kasa_banka_hareketleri_tenant_id_ekstre_satir_id_idx" ON "kasa_banka_hareketleri"("tenant_id", "ekstre_satir_id");
ALTER TABLE "kasa_banka_hareketleri" ADD CONSTRAINT "kasa_banka_hareketleri_ekstre_satir_id_fkey" FOREIGN KEY ("ekstre_satir_id") REFERENCES "banka_ekstre_satirlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ekstre_kurallari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "banka_hesap_id" UUID,
    "anahtar" TEXT NOT NULL,
    "yon" "EkstreKuralYonu" NOT NULL,
    "eslesme_turu" "EkstreEslesmeTuru" NOT NULL,
    "cari_id" UUID,
    "masraf_kategori_id" UUID,
    "gelir_kategori_id" UUID,
    "hedef_kasa_id" UUID,
    "hedef_banka_hesap_id" UUID,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "kullanim_sayisi" INTEGER NOT NULL DEFAULT 0,
    "son_kullanim" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ekstre_kurallari_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ekstre_kurallari_tenant_id_aktif_idx" ON "ekstre_kurallari"("tenant_id", "aktif");

ALTER TABLE "ekstre_kurallari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ekstre_kurallari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ekstre_kurallari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
