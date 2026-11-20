-- AI-107: onay talebinde sürüm + parametre özeti (düzenleme yeni sürüm üretir; eski sürümle
-- onay reddedilir) ve talep başına tek karar kaydı (kanal ve sürümle; içerik açık metin yazılmaz).

ALTER TABLE "ai_onay_talepleri" ADD COLUMN IF NOT EXISTS "surum" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ai_onay_talepleri" ADD COLUMN IF NOT EXISTS "parametre_ozeti" VARCHAR(64);

CREATE TABLE IF NOT EXISTS "ai_onay_kararlari" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "talep_id" UUID NOT NULL,
    "karar" VARCHAR(20) NOT NULL,
    "karar_veren_id" UUID NOT NULL,
    "kanal" VARCHAR(12) NOT NULL,
    "surum" INTEGER NOT NULL,
    "parametre_ozeti" VARCHAR(64),
    "ek_dogrulama" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_onay_kararlari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_onay_kararlari_talep_id_key" UNIQUE ("talep_id"),
    CONSTRAINT "ai_onay_kararlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_onay_kararlari_talep_id_fkey" FOREIGN KEY ("talep_id") REFERENCES "ai_onay_talepleri"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_onay_kararlari_karar_veren_id_fkey" FOREIGN KEY ("karar_veren_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_onay_kararlari_karar_check" CHECK (karar IN ('onaylandi', 'reddedildi')),
    CONSTRAINT "ai_onay_kararlari_kanal_check" CHECK (kanal IN ('WEB', 'TELEGRAM', 'MCP'))
);
CREATE INDEX IF NOT EXISTS "ai_onay_kararlari_tenant_created_idx" ON "ai_onay_kararlari"("tenant_id", "created_at");

ALTER TABLE "ai_onay_kararlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_onay_kararlari" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_ai_onay_kararlari ON "ai_onay_kararlari";
CREATE POLICY tenant_isolation_ai_onay_kararlari ON "ai_onay_kararlari"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- SEC-17
CREATE TRIGGER kbag_ai_onay_kararlari_talep_id_fkey AFTER INSERT OR UPDATE OF talep_id, tenant_id ON "ai_onay_kararlari"
  FOR EACH ROW WHEN (NEW.talep_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('talep_id', 'ai_onay_talepleri', 'id');
CREATE TRIGGER kbag_ai_onay_kararlari_karar_veren_id_fkey AFTER INSERT OR UPDATE OF karar_veren_id, tenant_id ON "ai_onay_kararlari"
  FOR EACH ROW WHEN (NEW.karar_veren_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('karar_veren_id', 'users', 'id');
GRANT SELECT, INSERT ON "ai_onay_kararlari" TO tekir_app;
