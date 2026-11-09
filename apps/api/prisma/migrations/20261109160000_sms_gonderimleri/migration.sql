-- ILT-06/10/13: SMS gönderim kaydı (metin saklanmaz) ve carinin hatırlatma SMS izni (varsayılan kapalı).
CREATE TABLE "sms_gonderimleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "anahtar" VARCHAR(128),
    "tur" VARCHAR(40) NOT NULL,
    "telefon" VARCHAR(16) NOT NULL,
    "durum" VARCHAR(14) NOT NULL,
    "parca" INTEGER NOT NULL DEFAULT 1,
    "hata" TEXT,
    "gorev_no" TEXT,
    "cari_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sms_gonderimleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sms_gonderimleri_durum_check" CHECK ("durum" IN ('gonderiliyor', 'gonderildi', 'basarisiz', 'belirsiz'))
);
CREATE UNIQUE INDEX "sms_gonderimleri_tenant_id_anahtar_key" ON "sms_gonderimleri"("tenant_id", "anahtar");
CREATE INDEX "sms_gonderimleri_tenant_id_created_at_idx" ON "sms_gonderimleri"("tenant_id", "created_at");
ALTER TABLE "sms_gonderimleri" ADD CONSTRAINT "sms_gonderimleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sms_gonderimleri" ADD CONSTRAINT "sms_gonderimleri_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sms_gonderimleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sms_gonderimleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sms_gonderimleri ON "sms_gonderimleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
-- SEC-17: bağlı cari aynı kiracıda olmalı.
CREATE TRIGGER kbag_sms_gonderimleri_cari_id_fkey AFTER INSERT OR UPDATE OF cari_id, tenant_id ON "sms_gonderimleri"
  FOR EACH ROW WHEN (NEW.cari_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('cari_id', 'cari_hesaplar', 'id');

ALTER TABLE "cari_hesaplar" ADD COLUMN "sms_hatirlatma" BOOLEAN NOT NULL DEFAULT false;
