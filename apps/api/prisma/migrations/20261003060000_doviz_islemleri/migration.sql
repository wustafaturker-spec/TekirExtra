-- P1-2a: döviz alım/satımı (iki kurlu virman) ve kambiyo kâr/zararı.
ALTER TYPE "EkstreEslesmeTuru" ADD VALUE 'doviz_islem';

CREATE TABLE "doviz_islemleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tarih" DATE NOT NULL,
    "cikan_tutar" DECIMAL(15,2) NOT NULL,
    "cikan_doviz" "DovizCinsi" NOT NULL,
    "cikan_kur" DECIMAL(15,6) NOT NULL,
    "cikan_try" DECIMAL(15,2) NOT NULL,
    "giren_tutar" DECIMAL(15,2) NOT NULL,
    "giren_doviz" "DovizCinsi" NOT NULL,
    "giren_kur" DECIMAL(15,6) NOT NULL,
    "giren_try" DECIMAL(15,2) NOT NULL,
    "fark_try" DECIMAL(15,2) NOT NULL,
    "gidis_hareket_id" UUID NOT NULL,
    "gelis_hareket_id" UUID NOT NULL,
    "kambiyo_gelir_id" UUID,
    "kambiyo_masraf_id" UUID,
    "banka_masraf_id" UUID,
    "aciklama" TEXT,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "doviz_islemleri_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "doviz_islemleri_gidis_hareket_id_key" ON "doviz_islemleri"("gidis_hareket_id");
CREATE UNIQUE INDEX "doviz_islemleri_gelis_hareket_id_key" ON "doviz_islemleri"("gelis_hareket_id");
CREATE UNIQUE INDEX "doviz_islemleri_kambiyo_gelir_id_key" ON "doviz_islemleri"("kambiyo_gelir_id");
CREATE UNIQUE INDEX "doviz_islemleri_kambiyo_masraf_id_key" ON "doviz_islemleri"("kambiyo_masraf_id");
CREATE UNIQUE INDEX "doviz_islemleri_banka_masraf_id_key" ON "doviz_islemleri"("banka_masraf_id");
CREATE INDEX "doviz_islemleri_tenant_id_tarih_idx" ON "doviz_islemleri"("tenant_id", "tarih");
ALTER TABLE "doviz_islemleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doviz_islemleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "doviz_islemleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
