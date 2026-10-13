-- AI-04: kullanıcı onayı bekleyen yapay zekâ işlemleri

CREATE TYPE "AiIslemKaynagi" AS ENUM ('asistan', 'mcp');
CREATE TYPE "AiOnayTalepDurumu" AS ENUM ('bekliyor', 'isleniyor', 'onaylandi', 'reddedildi', 'suresi_doldu', 'hata');
ALTER TYPE "BildirimTuru" ADD VALUE IF NOT EXISTS 'yapay_zeka';

CREATE TABLE "ai_onay_talepleri" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "oturum_id" UUID,
    "kaynak" "AiIslemKaynagi" NOT NULL,
    "arac" TEXT NOT NULL,
    "parametreler" JSONB NOT NULL,
    "ozet" TEXT NOT NULL,
    "durum" "AiOnayTalepDurumu" NOT NULL DEFAULT 'bekliyor',
    "gecerlilik_sonu" TIMESTAMP(3) NOT NULL,
    "karar_at" TIMESTAMP(3),
    "sonuc" JSONB,
    "hata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_onay_talepleri_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_onay_talepleri_tenant_id_user_id_durum_idx" ON "ai_onay_talepleri"("tenant_id", "user_id", "durum");

ALTER TABLE "ai_onay_talepleri" ADD CONSTRAINT "ai_onay_talepleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_onay_talepleri" ADD CONSTRAINT "ai_onay_talepleri_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_onay_talepleri" ADD CONSTRAINT "ai_onay_talepleri_oturum_id_fkey" FOREIGN KEY ("oturum_id") REFERENCES "ajan_oturumlari"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_onay_talepleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_onay_talepleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_onay_talepleri"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
