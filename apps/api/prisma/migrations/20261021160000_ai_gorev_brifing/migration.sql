-- AI-83: günlük brifing görev türü.
ALTER TABLE "tenant_ai_gorevleri" DROP CONSTRAINT "tenant_ai_gorevleri_tur_check";
ALTER TABLE "tenant_ai_gorevleri" ADD CONSTRAINT "tenant_ai_gorevleri_tur_check" CHECK ("tur" IN ('ASISTAN', 'NAKIT_TAHSILAT', 'BRIFING'));
