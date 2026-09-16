-- Kısmi teslim (SAT-09).
--
-- Sipariş artık tek seferde değil, parça parça irsaliyeye dönüşebilir: satırda
-- teslim edilen miktar birikir, kalanı olan sipariş "kismen_kapandi" durumunda
-- açık kalır. Kural alışta mal kabul, satışta sevkiyat için aynıdır. Stok
-- etkisi değişmez; düşüm faturada kalır (S-01 2026-07-13).

-- AlterEnum
ALTER TYPE "ZincirBelgeDurum" ADD VALUE IF NOT EXISTS 'kismen_kapandi' BEFORE 'kapandi';

-- AlterTable
ALTER TABLE "belge_satirlari"
  ADD COLUMN "teslim_edilen_miktar" DECIMAL(15,3) NOT NULL DEFAULT 0,
  ADD COLUMN "kaynak_satir_id" UUID;

-- AddForeignKey: türetilen irsaliye satırı, türediği sipariş satırını gösterir.
-- Sipariş satırı silinirse bağ kopar ama irsaliye satırı durur (ON DELETE SET NULL).
ALTER TABLE "belge_satirlari"
  ADD CONSTRAINT "belge_satirlari_kaynak_satir_id_fkey"
  FOREIGN KEY ("kaynak_satir_id") REFERENCES "belge_satirlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "belge_satirlari_kaynak_satir_id_idx" ON "belge_satirlari"("kaynak_satir_id");
