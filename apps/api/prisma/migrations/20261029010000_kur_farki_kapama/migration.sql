-- KSB-26: kur farkı kalemi kapamadan türer; faturalama/eşleştirme/kapatma bağı
-- kapamada tutulur. Eski hareket düzeyindeki bağlar, hareketin aynı faturaya
-- yazdığı kapamaya taşınır ve o kapama sabitlenir (elle).
UPDATE "fatura_kapamalari" k
SET "kur_farki_fatura_id" = COALESCE(k."kur_farki_fatura_id", h."kur_farki_fatura_id"),
    "kur_farki_kapandi" = k."kur_farki_kapandi" OR h."kur_farki_kapandi",
    "otomatik" = false
FROM "kasa_banka_hareketleri" h
WHERE k."kasa_banka_hareket_id" = h."id"
  AND k."fatura_id" = h."fatura_id"
  AND (h."kur_farki_fatura_id" IS NOT NULL OR h."kur_farki_kapandi");

-- KSB-29: kur farkı faturası ödenmez; kesinleşince "kur farkı karşılığı" cari
-- hareketiyle kapanır. Bu kapamanın kaynağı o cari harekettir.
ALTER TABLE "fatura_kapamalari" ADD COLUMN "cari_hareket_id" UUID;
ALTER TABLE "fatura_kapamalari" ADD CONSTRAINT "fatura_kapamalari_cari_hareket_id_fkey" FOREIGN KEY ("cari_hareket_id") REFERENCES "cari_hareketler"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "fatura_kapamalari_cari_hareket_id_idx" ON "fatura_kapamalari"("cari_hareket_id");
ALTER TABLE "fatura_kapamalari" DROP CONSTRAINT "fatura_kapamalari_tek_kaynak";
ALTER TABLE "fatura_kapamalari" ADD CONSTRAINT "fatura_kapamalari_tek_kaynak"
  CHECK (num_nonnulls(kasa_banka_hareket_id, kredi_karti_hareket_id, cek_senet_id, iade_fatura_id, mahsup_id, cari_hareket_id) = 1);
