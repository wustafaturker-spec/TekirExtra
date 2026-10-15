-- AI-16: yapay zekâ görevleri gerçek, veriye dayalı göreve çevrilir.

ALTER TABLE "tenant_ai_gorevleri" ADD COLUMN "user_id" UUID;
ALTER TABLE "tenant_ai_gorevleri" ADD COLUMN "gunler" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "tenant_ai_gorevleri" ADD COLUMN "esik_tutar" DECIMAL(15,2);
ALTER TABLE "tenant_ai_gorevleri" ADD COLUMN "son_tetik_gunu" DATE;

-- Var olan görevlerin sahibi: kiracının ilk etkin yöneticisi. WhatsApp kanalı kalkar;
-- sonuç artık bildirim olarak gelir (e-posta bildirim tercihine göre).
UPDATE "tenant_ai_gorevleri" g SET "user_id" = (
  SELECT u."id" FROM "users" u WHERE u."tenant_id" = g."tenant_id" AND u."rol" = 'yonetici' AND u."aktif" ORDER BY u."created_at" LIMIT 1
) WHERE g."user_id" IS NULL;
UPDATE "tenant_ai_gorevleri" SET "kanal" = 'PANEL' WHERE "kanal" = 'WHATSAPP';
ALTER TABLE "tenant_ai_gorevleri" ALTER COLUMN "kanal" SET DEFAULT 'PANEL';
