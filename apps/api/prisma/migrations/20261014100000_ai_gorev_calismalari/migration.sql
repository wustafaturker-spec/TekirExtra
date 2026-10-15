CREATE TYPE "AiGorevCalismaDurumu" AS ENUM ('calisiyor', 'basarili', 'hata', 'kosul_saglanmadi');

CREATE TABLE "tenant_ai_gorev_calismalari" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "gorev_id" UUID NOT NULL,
  "tetik_gunu" DATE NOT NULL,
  "durum" "AiGorevCalismaDurumu" NOT NULL,
  "deneme" INTEGER NOT NULL DEFAULT 1,
  "sahiplik_anahtari" UUID NOT NULL,
  "sonraki_deneme_at" TIMESTAMP(3),
  "basladi_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "bitti_at" TIMESTAMP(3),
  "sonuc" TEXT,
  "hata" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "guncellendi_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_ai_gorev_calismalari_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_ai_gorev_calismalari_gorev_id_tetik_gunu_key"
  ON "tenant_ai_gorev_calismalari"("gorev_id", "tetik_gunu");
CREATE INDEX "tenant_ai_gorev_calismalari_tenant_id_durum_sonraki_deneme_at_idx"
  ON "tenant_ai_gorev_calismalari"("tenant_id", "durum", "sonraki_deneme_at");
ALTER TABLE "tenant_ai_gorev_calismalari"
  ADD CONSTRAINT "tenant_ai_gorev_calismalari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_ai_gorev_calismalari"
  ADD CONSTRAINT "tenant_ai_gorev_calismalari_gorev_id_fkey" FOREIGN KEY ("gorev_id") REFERENCES "tenant_ai_gorevleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_ai_gorev_calismalari" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_ai_gorev_calismalari"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
