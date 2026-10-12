-- Tenant AI Özelleştirme (BYOK & Kurallar) ve Otomasyon Görevleri

CREATE TABLE IF NOT EXISTS "tenant_ai_ayarlari" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "saglayici" TEXT NOT NULL DEFAULT 'varsayilan',
    "api_key" TEXT,
    "model_adi" TEXT,
    "base_url" TEXT,
    "ozel_talimatlar" TEXT,
    "guvenlik_kurallari" JSONB,
    "guncellendi_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_ai_ayarlari_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_ai_ayarlari_tenant_id_key" ON "tenant_ai_ayarlari"("tenant_id");

ALTER TABLE "tenant_ai_ayarlari" ADD CONSTRAINT "tenant_ai_ayarlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "tenant_ai_gorevleri" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "ad" TEXT NOT NULL,
    "tetikleyici" TEXT NOT NULL,
    "zamanlama_cron" TEXT,
    "gorev_talimati" TEXT NOT NULL,
    "kanal" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "hedef_kimlik" TEXT,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "son_calisma" TIMESTAMP(3),
    "son_sonuc" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_ai_gorevleri_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tenant_ai_gorevleri_tenant_id_aktif_idx" ON "tenant_ai_gorevleri"("tenant_id", "aktif");

ALTER TABLE "tenant_ai_gorevleri" ADD CONSTRAINT "tenant_ai_gorevleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (Kiracı Yalıtımı)
ALTER TABLE "tenant_ai_ayarlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_ai_ayarlari" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenant_ai_ayarlari";
CREATE POLICY tenant_isolation ON "tenant_ai_ayarlari"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "tenant_ai_gorevleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_ai_gorevleri" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenant_ai_gorevleri";
CREATE POLICY tenant_isolation ON "tenant_ai_gorevleri"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
