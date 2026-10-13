-- AI-09: kullanıcı başına MCP erişim anahtarları (yalnız özet saklanır)

CREATE TABLE "ai_mcp_anahtarlari" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ad" TEXT NOT NULL,
    "on_ek" TEXT NOT NULL,
    "ozet" TEXT NOT NULL,
    "son_kullanim" TIMESTAMP(3),
    "iptal_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_mcp_anahtarlari_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_mcp_anahtarlari_ozet_key" ON "ai_mcp_anahtarlari"("ozet");
CREATE INDEX "ai_mcp_anahtarlari_tenant_id_user_id_idx" ON "ai_mcp_anahtarlari"("tenant_id", "user_id");

ALTER TABLE "ai_mcp_anahtarlari" ADD CONSTRAINT "ai_mcp_anahtarlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_mcp_anahtarlari" ADD CONSTRAINT "ai_mcp_anahtarlari_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_mcp_anahtarlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_mcp_anahtarlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_mcp_anahtarlari"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
