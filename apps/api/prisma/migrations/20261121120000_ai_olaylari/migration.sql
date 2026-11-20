-- AI-106: yapay zekâ olay kaydı ve giden kutusu (outbox). Olay iş kaydıyla aynı işlemde
-- yazılır; worker'daki teslimatçı bildirime çevirir (bildirim birleşim anahtarıyla tekil,
-- tekrar teslim çift bildirim üretmez). Görev olayları `sira` imleciyle sırasıyla okunur.
-- 30 gün saklanır.

CREATE TABLE IF NOT EXISTS "ai_olaylari" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sira" BIGSERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "toplu_tur" VARCHAR(30) NOT NULL,
    "toplu_id" UUID NOT NULL,
    "tur" VARCHAR(60) NOT NULL,
    "surum" SMALLINT NOT NULL DEFAULT 1,
    "yuk" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "teslim_durumu" VARCHAR(20) NOT NULL DEFAULT 'bekliyor',
    "deneme" SMALLINT NOT NULL DEFAULT 0,
    "sonraki_deneme_at" TIMESTAMP(3),
    "sahiplik_anahtari" UUID,
    "kira_bitis_at" TIMESTAMP(3),
    "hata" TEXT,
    "teslim_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_olaylari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_olaylari_sira_key" UNIQUE ("sira"),
    CONSTRAINT "ai_olaylari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_olaylari_teslim_durumu_check" CHECK (teslim_durumu IN ('bekliyor', 'teslim_edildi', 'teslim_edilemedi', 'teslim_gerekmez')),
    CONSTRAINT "ai_olaylari_toplu_tur_check" CHECK (toplu_tur IN ('asistan_gorevi', 'ai_onay'))
);

CREATE INDEX IF NOT EXISTS "ai_olaylari_teslim_idx" ON "ai_olaylari"("teslim_durumu", "sonraki_deneme_at");
CREATE INDEX IF NOT EXISTS "ai_olaylari_toplu_idx" ON "ai_olaylari"("tenant_id", "toplu_tur", "toplu_id", "sira");
CREATE INDEX IF NOT EXISTS "ai_olaylari_created_at_idx" ON "ai_olaylari"("created_at");

ALTER TABLE "ai_olaylari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_olaylari" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_ai_olaylari ON "ai_olaylari";
CREATE POLICY tenant_isolation_ai_olaylari ON "ai_olaylari"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT ON "ai_olaylari" TO tekir_app;
GRANT USAGE, SELECT ON SEQUENCE "ai_olaylari_sira_seq" TO tekir_app;
