-- GLR-06: bizden kesilen stopajın beyannamede mahsup edildi işareti. Kayıt üretmez; kaynak gelir/fatura/pazaryeri kesintisidir.
CREATE TABLE "pesin_vergi_mahsuplari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kaynak_tur" VARCHAR(20) NOT NULL,
    "kaynak_id" UUID NOT NULL,
    "beyanname_turu" VARCHAR(20) NOT NULL,
    "yil" INTEGER NOT NULL,
    "donem" INTEGER,
    "not" TEXT,
    "tutar_try" DECIMAL(15,2) NOT NULL,
    "belge_tarihi" DATE NOT NULL,
    "etiket" TEXT NOT NULL,
    "isaretleyen_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pesin_vergi_mahsuplari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pesin_vergi_mahsuplari_kaynak_check" CHECK ("kaynak_tur" IN ('gelir', 'fatura', 'pazaryeri')),
    CONSTRAINT "pesin_vergi_mahsuplari_beyanname_check" CHECK (("beyanname_turu" = 'gecici_vergi' AND "donem" BETWEEN 1 AND 4) OR ("beyanname_turu" = 'yillik' AND "donem" IS NULL))
);
CREATE UNIQUE INDEX "pesin_vergi_mahsuplari_tenant_id_kaynak_tur_kaynak_id_key" ON "pesin_vergi_mahsuplari"("tenant_id", "kaynak_tur", "kaynak_id");
CREATE INDEX "pesin_vergi_mahsuplari_tenant_id_yil_idx" ON "pesin_vergi_mahsuplari"("tenant_id", "yil");
ALTER TABLE "pesin_vergi_mahsuplari" ADD CONSTRAINT "pesin_vergi_mahsuplari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pesin_vergi_mahsuplari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pesin_vergi_mahsuplari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_pesin_vergi_mahsuplari ON "pesin_vergi_mahsuplari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
