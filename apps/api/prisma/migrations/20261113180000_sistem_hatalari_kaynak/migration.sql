-- PLT-123: worker ve Telegram süreçlerinin hataları da gruplanır; kaynak kısıtı genişler.
ALTER TABLE "sistem_hatalari" DROP CONSTRAINT IF EXISTS "sistem_hatalari_kaynak_check";
ALTER TABLE "sistem_hatalari" ADD CONSTRAINT "sistem_hatalari_kaynak_check" CHECK ("kaynak" IN ('api', 'web', 'worker', 'telegram'));
