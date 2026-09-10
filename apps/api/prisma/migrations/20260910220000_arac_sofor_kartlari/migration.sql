-- Kayıtlı araç ve şoför kartları (EBLG-25). İrsaliye bu kartları referans
-- almaz; seçildiğinde değerler belgeye kopyalanır, böylece kart değişse de
-- GİB'e gitmiş belge olduğu gibi kalır.
CREATE TABLE "araclar" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "plaka" TEXT NOT NULL,
  "dorse_plaka" TEXT,
  "aciklama" TEXT,
  "aktif" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "araclar_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "araclar_tenant_id_plaka_key" ON "araclar"("tenant_id", "plaka");
CREATE INDEX "araclar_tenant_id_aktif_idx" ON "araclar"("tenant_id", "aktif");

CREATE TABLE "soforler" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "ad" TEXT NOT NULL,
  "soyad" TEXT NOT NULL,
  "tckn" TEXT,
  "aktif" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "soforler_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "soforler_tenant_id_aktif_idx" ON "soforler"("tenant_id", "aktif");

ALTER TABLE "araclar" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "araclar" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_araclar" ON "araclar" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "soforler" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "soforler" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_soforler" ON "soforler" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
