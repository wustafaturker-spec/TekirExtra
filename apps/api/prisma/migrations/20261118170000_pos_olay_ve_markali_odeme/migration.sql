-- AlterTable pos_tahsilatlari
ALTER TABLE "pos_tahsilatlari" ADD COLUMN IF NOT EXISTS "odeme_token_ozeti" VARCHAR(64);
ALTER TABLE "pos_tahsilatlari" ADD COLUMN IF NOT EXISTS "odeme_goruntulenme" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "pos_tahsilatlari" ADD COLUMN IF NOT EXISTS "son_goruntulenme" TIMESTAMP(3);

-- CreateTable pos_olay_kayitlari
CREATE TABLE IF NOT EXISTS "pos_olay_kayitlari" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "pos_tahsilat_id" UUID NOT NULL,
    "saglayici" VARCHAR(32) NOT NULL,
    "is_anahtari" VARCHAR(128) NOT NULL,
    "olay_turu" VARCHAR(32) NOT NULL,
    "durum" VARCHAR(32) NOT NULL DEFAULT 'alindi',
    "istek_ozeti" JSONB,
    "yanit_kodu" INTEGER,
    "hata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_olay_kayitlari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pos_olay_kayitlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pos_olay_kayitlari_pos_tahsilat_id_fkey" FOREIGN KEY ("pos_tahsilat_id") REFERENCES "pos_tahsilatlari"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "pos_olay_kayitlari_tenant_id_is_anahtari_key" ON "pos_olay_kayitlari"("tenant_id", "is_anahtari");
CREATE INDEX IF NOT EXISTS "pos_olay_kayitlari_tenant_id_pos_tahsilat_id_created_at_idx" ON "pos_olay_kayitlari"("tenant_id", "pos_tahsilat_id", "created_at");

ALTER TABLE "pos_olay_kayitlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_olay_kayitlari" FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'pos_olay_kayitlari' AND policyname = 'tenant_isolation_pos_olay_kayitlari'
  ) THEN
    CREATE POLICY tenant_isolation_pos_olay_kayitlari ON "pos_olay_kayitlari"
      USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- CreateTable pos_odeme_denemeleri
CREATE TABLE IF NOT EXISTS "pos_odeme_denemeleri" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "pos_tahsilat_id" UUID NOT NULL,
    "deneme_no" INTEGER NOT NULL DEFAULT 1,
    "saglayici" VARCHAR(32) NOT NULL,
    "saglayici_token" TEXT,
    "durum" VARCHAR(32) NOT NULL DEFAULT 'baslatildi',
    "hata_mesaji" TEXT,
    "ip_adresi" VARCHAR(64),
    "tarayici" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tamamlandi_at" TIMESTAMP(3),

    CONSTRAINT "pos_odeme_denemeleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pos_odeme_denemeleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pos_odeme_denemeleri_pos_tahsilat_id_fkey" FOREIGN KEY ("pos_tahsilat_id") REFERENCES "pos_tahsilatlari"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "pos_odeme_denemeleri_tenant_id_pos_tahsilat_id_deneme_no_idx" ON "pos_odeme_denemeleri"("tenant_id", "pos_tahsilat_id", "deneme_no");

ALTER TABLE "pos_odeme_denemeleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_odeme_denemeleri" FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'pos_odeme_denemeleri' AND policyname = 'tenant_isolation_pos_odeme_denemeleri'
  ) THEN
    CREATE POLICY tenant_isolation_pos_odeme_denemeleri ON "pos_odeme_denemeleri"
      USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Secure helper: Resolve tenant_id from tahsilat_id without trusting client URL param
CREATE OR REPLACE FUNCTION pos_tahsilat_kiraci_coz(p_tahsilat_id UUID)
RETURNS UUID AS $$
  SELECT tenant_id FROM pos_tahsilatlari WHERE id = p_tahsilat_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
