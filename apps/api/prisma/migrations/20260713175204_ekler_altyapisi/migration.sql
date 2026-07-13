-- CreateEnum
CREATE TYPE "EkSahipTur" AS ENUM ('cari', 'stok', 'fatura', 'kasa_banka');

-- CreateTable
CREATE TABLE "ekler" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sahip_tur" "EkSahipTur" NOT NULL,
    "sahip_id" UUID NOT NULL,
    "dosya_adi" TEXT NOT NULL,
    "mime_tip" TEXT NOT NULL,
    "boyut" INTEGER NOT NULL,
    "depo_anahtari" TEXT NOT NULL,
    "yukleyen_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ekler_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ekler_depo_anahtari_key" ON "ekler"("depo_anahtari");

-- CreateIndex
CREATE INDEX "ekler_tenant_id_sahip_tur_sahip_id_idx" ON "ekler"("tenant_id", "sahip_tur", "sahip_id");

-- Kiracı yalıtımı (KLN-06): ekler tablosu
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ekler'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t);
  END LOOP;
END
$$;
