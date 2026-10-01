-- Reçete satırı küçük sarf miktarları (ör. kg kimyasaldan mg) ve girilen birim.
ALTER TABLE "urun_recetesi_kalemleri" ADD COLUMN     "birim" TEXT,
ADD COLUMN     "girilen_miktar" DECIMAL(20,8),
ALTER COLUMN "miktar" SET DATA TYPE DECIMAL(24,12),
ALTER COLUMN "fire_orani" SET DATA TYPE DECIMAL(10,6);
