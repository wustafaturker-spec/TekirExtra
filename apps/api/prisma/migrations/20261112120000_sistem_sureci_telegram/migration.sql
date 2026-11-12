-- CNL-14: Telegram ayrı süreç olarak nabız yazar (sistem_surecleri.tur = 'telegram').
ALTER TABLE "sistem_surecleri" DROP CONSTRAINT "sistem_surecleri_tur_check";
ALTER TABLE "sistem_surecleri" ADD CONSTRAINT "sistem_surecleri_tur_check" CHECK ("tur" IN ('api', 'worker', 'telegram'));
