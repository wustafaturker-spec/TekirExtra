-- KSB-25: alış–satış faturası mahsubu. Mahsup kaydı aynı carinin açık satış
-- tarafını (satış, alış iadesi) ve alış tarafını (alış, satış iadesi) aynı
-- tutarla kapatır; kapamalar elle kapama olarak (otomatik = false) yazılır ve
-- mahsup_id ile bağlanır. Geri alınan mahsup kaydı iz için kalır.
CREATE TABLE "cari_mahsuplari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cari_id" UUID NOT NULL,
    "tarih" DATE NOT NULL,
    "doviz_cinsi" VARCHAR(3) NOT NULL,
    "tutar" DECIMAL(15,2) NOT NULL,
    "aciklama" VARCHAR(500),
    "otomatik" BOOLEAN NOT NULL DEFAULT false,
    "olusturan_user_id" UUID,
    "geri_alindi_at" TIMESTAMP(3),
    "geri_alan_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cari_mahsuplari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cari_mahsuplari_tutar_check" CHECK ("tutar" > 0)
);
CREATE INDEX "cari_mahsuplari_tenant_id_cari_id_tarih_idx" ON "cari_mahsuplari"("tenant_id", "cari_id", "tarih");
ALTER TABLE "cari_mahsuplari" ADD CONSTRAINT "cari_mahsuplari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cari_mahsuplari" ADD CONSTRAINT "cari_mahsuplari_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cari_mahsuplari" ADD CONSTRAINT "cari_mahsuplari_olusturan_user_id_fkey" FOREIGN KEY ("olusturan_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cari_mahsuplari" ADD CONSTRAINT "cari_mahsuplari_geri_alan_user_id_fkey" FOREIGN KEY ("geri_alan_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE cari_mahsuplari ENABLE ROW LEVEL SECURITY;
ALTER TABLE cari_mahsuplari FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cari_mahsuplari USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE "fatura_kapamalari" ADD COLUMN "mahsup_id" UUID;
ALTER TABLE "fatura_kapamalari" ADD CONSTRAINT "fatura_kapamalari_mahsup_id_fkey" FOREIGN KEY ("mahsup_id") REFERENCES "cari_mahsuplari"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "fatura_kapamalari_mahsup_id_idx" ON "fatura_kapamalari"("mahsup_id");

ALTER TABLE "cari_hesaplar" ADD COLUMN "otomatik_mahsup" BOOLEAN NOT NULL DEFAULT false;
