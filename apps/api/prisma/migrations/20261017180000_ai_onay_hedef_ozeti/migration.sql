-- AI-27: onay talebi hedef kaydın içeriğine bağlanır; talepten sonra kayıt değişirse onay işlemez.
ALTER TYPE "AiOnayTalepDurumu" ADD VALUE IF NOT EXISTS 'hedef_degisti';
ALTER TABLE "ai_onay_talepleri" ADD COLUMN "hedef_ozeti" VARCHAR(64);
