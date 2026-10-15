-- AI-23: görev türü
ALTER TABLE "tenant_ai_gorevleri" ADD COLUMN "tur" TEXT NOT NULL DEFAULT 'ASISTAN';
ALTER TABLE "tenant_ai_gorevleri" ADD CONSTRAINT "tenant_ai_gorevleri_tur_check" CHECK ("tur" IN ('ASISTAN', 'NAKIT_TAHSILAT'));

-- AI-24: içgörü kayıtları
CREATE TABLE "ai_icgoruler" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "gorev_id" UUID,
  "user_id" UUID NOT NULL,
  "tekil_anahtar" VARCHAR(120) NOT NULL,
  "onem" TEXT NOT NULL CHECK ("onem" IN ('kritik', 'uyari', 'bilgi')),
  "durum" TEXT NOT NULL DEFAULT 'yeni' CHECK ("durum" IN ('yeni', 'goruldu', 'cozuldu')),
  "baslik" VARCHAR(200) NOT NULL,
  "ozet" TEXT NOT NULL,
  "metrikler" JSONB NOT NULL DEFAULT '{}',
  "bulgular" JSONB NOT NULL DEFAULT '[]',
  "kanitlar" JSONB NOT NULL DEFAULT '[]',
  "varsayimlar" JSONB NOT NULL DEFAULT '[]',
  "uyarilar" JSONB NOT NULL DEFAULT '[]',
  "hesaplandi_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_icgoruler_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_icgoruler_tenant_id_tekil_anahtar_key" ON "ai_icgoruler"("tenant_id", "tekil_anahtar");
CREATE INDEX "ai_icgoruler_tenant_id_durum_hesaplandi_at_idx" ON "ai_icgoruler"("tenant_id", "durum", "hesaplandi_at");
ALTER TABLE "ai_icgoruler"
  ADD CONSTRAINT "ai_icgoruler_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_icgoruler"
  ADD CONSTRAINT "ai_icgoruler_gorev_id_fkey" FOREIGN KEY ("gorev_id") REFERENCES "tenant_ai_gorevleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_icgoruler" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_icgoruler" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_icgoruler"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
