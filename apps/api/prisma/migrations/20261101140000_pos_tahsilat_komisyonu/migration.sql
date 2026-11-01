-- KSB-36: POS tahsilatında taksit, müşterinin ödediği tutar (bilgi), komisyon ve net.
-- Eski tahsilatlarda komisyon boş kalır; bankaya aktarım önerisi hesabın oranına düşer.
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "taksit_sayisi" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "odenen_tutar" DECIMAL(15,2);
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "komisyon_orani" DECIMAL(5,2);
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "komisyon_tutari" DECIMAL(15,2);
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "net_tutar" DECIMAL(15,2);
ALTER TABLE "pos_tahsilatlari" ADD COLUMN "komisyon_kaynagi" TEXT;
ALTER TABLE "pos_tahsilatlari" ADD CONSTRAINT "pos_tahsilatlari_taksit_sayisi_check" CHECK ("taksit_sayisi" BETWEEN 1 AND 12);
ALTER TABLE "pos_tahsilatlari" ADD CONSTRAINT "pos_tahsilatlari_komisyon_kaynagi_check" CHECK ("komisyon_kaynagi" IS NULL OR "komisyon_kaynagi" IN ('tahmin', 'saglayici'));
