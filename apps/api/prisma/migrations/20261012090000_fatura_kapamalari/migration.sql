-- KSB-16: vadeye göre otomatik fatura kapama (denkleştirme).
-- AlterTable
ALTER TABLE "cari_hesaplar" ADD COLUMN     "denklestirme_baslangic" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "fatura_kapamalari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cari_id" UUID NOT NULL,
    "fatura_id" UUID NOT NULL,
    "tutar" DECIMAL(15,2) NOT NULL,
    "otomatik" BOOLEAN NOT NULL DEFAULT true,
    "kasa_banka_hareket_id" UUID,
    "kredi_karti_hareket_id" UUID,
    "cek_senet_id" UUID,
    "iade_fatura_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fatura_kapamalari_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fatura_kapamalari_tenant_id_fatura_id_idx" ON "fatura_kapamalari"("tenant_id", "fatura_id");

-- CreateIndex
CREATE INDEX "fatura_kapamalari_tenant_id_cari_id_idx" ON "fatura_kapamalari"("tenant_id", "cari_id");

-- CreateIndex
CREATE INDEX "fatura_kapamalari_kasa_banka_hareket_id_idx" ON "fatura_kapamalari"("kasa_banka_hareket_id");

-- CreateIndex
CREATE INDEX "fatura_kapamalari_kredi_karti_hareket_id_idx" ON "fatura_kapamalari"("kredi_karti_hareket_id");

-- CreateIndex
CREATE INDEX "fatura_kapamalari_cek_senet_id_idx" ON "fatura_kapamalari"("cek_senet_id");

-- CreateIndex
CREATE INDEX "fatura_kapamalari_iade_fatura_id_idx" ON "fatura_kapamalari"("iade_fatura_id");

-- AddForeignKey
ALTER TABLE "fatura_kapamalari" ADD CONSTRAINT "fatura_kapamalari_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fatura_kapamalari" ADD CONSTRAINT "fatura_kapamalari_fatura_id_fkey" FOREIGN KEY ("fatura_id") REFERENCES "faturalar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fatura_kapamalari" ADD CONSTRAINT "fatura_kapamalari_kasa_banka_hareket_id_fkey" FOREIGN KEY ("kasa_banka_hareket_id") REFERENCES "kasa_banka_hareketleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fatura_kapamalari" ADD CONSTRAINT "fatura_kapamalari_kredi_karti_hareket_id_fkey" FOREIGN KEY ("kredi_karti_hareket_id") REFERENCES "kredi_karti_hareketleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fatura_kapamalari" ADD CONSTRAINT "fatura_kapamalari_cek_senet_id_fkey" FOREIGN KEY ("cek_senet_id") REFERENCES "cek_senetler"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fatura_kapamalari" ADD CONSTRAINT "fatura_kapamalari_iade_fatura_id_fkey" FOREIGN KEY ("iade_fatura_id") REFERENCES "faturalar"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tam olarak bir kaynak.
ALTER TABLE "fatura_kapamalari" ADD CONSTRAINT "fatura_kapamalari_tek_kaynak"
  CHECK (num_nonnulls("kasa_banka_hareket_id", "kredi_karti_hareket_id", "cek_senet_id", "iade_fatura_id") = 1);
ALTER TABLE "fatura_kapamalari" ADD CONSTRAINT "fatura_kapamalari_tutar_arti" CHECK ("tutar" > 0);

-- Mevcut cariler: göçten önce girilmiş ödemeler/iadeler otomatik dağıtılmaz
-- (cari kartındaki "vadeye göre yeniden denkleştir" ile dağıtılır).
UPDATE "cari_hesaplar" SET "denklestirme_baslangic" = now();

-- Mevcut bağlantılar elle kapama olarak taşınır; ters kayıt ve POS iadesinin
-- geri açtığı mahsup düşülür. (RLS bundan sonra açılır: FORCE RLS göç
-- kullanıcısının kiracı bağlamı olmadan yazmasını engellerdi.)
INSERT INTO "fatura_kapamalari" ("id", "tenant_id", "cari_id", "fatura_id", "tutar", "otomatik", "kasa_banka_hareket_id", "created_at")
SELECT gen_random_uuid(), h."tenant_id", f."cari_id", h."fatura_id", net.tutar, false, h."id", h."created_at"
FROM "kasa_banka_hareketleri" h
JOIN "faturalar" f ON f."id" = h."fatura_id"
CROSS JOIN LATERAL (
  SELECT h."fatura_mahsubu"
    + COALESCE((SELECT sum(t."fatura_mahsubu") FROM "kasa_banka_hareketleri" t
                WHERE t."kaynak_tur" = 'ters_kayit' AND t."kaynak_ref" = h."id"::text AND t."fatura_mahsubu" < 0), 0)
    + COALESCE((SELECT sum(t."fatura_mahsubu") FROM "kasa_banka_hareketleri" t
                JOIN "pos_tahsilatlari" p ON p."id"::text = t."kaynak_ref"
                WHERE t."kaynak_tur" = 'pos_iade' AND p."hareket_id" = h."id" AND t."fatura_mahsubu" < 0), 0) AS tutar
) net
WHERE h."fatura_mahsubu" > 0 AND h."kaynak_tur" <> 'ters_kayit' AND net.tutar > 0;

INSERT INTO "fatura_kapamalari" ("id", "tenant_id", "cari_id", "fatura_id", "tutar", "otomatik", "kredi_karti_hareket_id", "created_at")
SELECT gen_random_uuid(), h."tenant_id", f."cari_id", h."fatura_id", h."fatura_mahsubu", false, h."id", h."created_at"
FROM "kredi_karti_hareketleri" h
JOIN "faturalar" f ON f."id" = h."fatura_id"
WHERE h."fatura_mahsubu" > 0 AND h."geri_alinan_hareket_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "kredi_karti_hareketleri" g WHERE g."geri_alinan_hareket_id" = h."id");

-- Kiracı yalıtımı (KLN-06)
ALTER TABLE "fatura_kapamalari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fatura_kapamalari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "fatura_kapamalari"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
