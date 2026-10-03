-- MUH-01…07: muhasebe aktarımı. Fişler saklanmaz; firmanın hesap kodu
-- düzeltmeleri, aktarım profili ve yapılan aktarımların kaydı tutulur.

CREATE TABLE "muhasebe_ayarlari" (
    "tenant_id" UUID NOT NULL,
    "hesap_kodlari" JSONB NOT NULL DEFAULT '{}',
    "aktarim_profili" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "muhasebe_ayarlari_pkey" PRIMARY KEY ("tenant_id")
);
ALTER TABLE "muhasebe_ayarlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "muhasebe_ayarlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "muhasebe_ayarlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE "muhasebe_aktarimlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "baslangic" DATE NOT NULL,
    "bitis" DATE NOT NULL,
    "bicim" TEXT NOT NULL,
    "fis_sayisi" INTEGER NOT NULL,
    "satir_sayisi" INTEGER NOT NULL,
    "borc_toplami" DECIMAL(18,2) NOT NULL,
    "parmak_izi" TEXT NOT NULL,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "muhasebe_aktarimlari_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "muhasebe_aktarimlari_tenant_id_created_at_idx" ON "muhasebe_aktarimlari"("tenant_id", "created_at");
ALTER TABLE "muhasebe_aktarimlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "muhasebe_aktarimlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "muhasebe_aktarimlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- MUH-03: alt hesap kodu; boşsa varsayılan üretilir.
ALTER TABLE "cari_hesaplar" ADD COLUMN "muhasebe_kodu" TEXT;
ALTER TABLE "kasalar" ADD COLUMN "muhasebe_kodu" TEXT;
ALTER TABLE "banka_hesaplari" ADD COLUMN "muhasebe_kodu" TEXT;
ALTER TABLE "pos_hesaplari" ADD COLUMN "muhasebe_kodu" TEXT;
ALTER TABLE "kredi_kartlari" ADD COLUMN "muhasebe_kodu" TEXT;
