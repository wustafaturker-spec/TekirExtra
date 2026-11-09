-- VTK: vergi ve SGK takvimi; firma ayarı, beyan tutarı ve ödeme işareti. Son tarihler Mevzuat Merkezi'ndedir.
CREATE TABLE "vergi_takvimi_ayarlari" (
    "tenant_id" UUID NOT NULL,
    "baslangic_yil" INTEGER NOT NULL,
    "baslangic_ay" INTEGER NOT NULL,
    "devreden_kdv" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "muhtasar_donemi" VARCHAR(10) NOT NULL DEFAULT 'aylik',
    "guncelleyen_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vergi_takvimi_ayarlari_pkey" PRIMARY KEY ("tenant_id"),
    CONSTRAINT "vergi_takvimi_ayarlari_ay_check" CHECK ("baslangic_ay" BETWEEN 1 AND 12),
    CONSTRAINT "vergi_takvimi_ayarlari_devreden_check" CHECK ("devreden_kdv" >= 0),
    CONSTRAINT "vergi_takvimi_ayarlari_donem_check" CHECK ("muhtasar_donemi" IN ('aylik', 'uc_aylik'))
);
CREATE TABLE "vergi_yukumluluk_kayitlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "yukumluluk" VARCHAR(12) NOT NULL,
    "yil" INTEGER NOT NULL,
    "ay" INTEGER NOT NULL,
    "beyan_tutari" DECIMAL(15,2),
    "beyan_devreden" DECIMAL(15,2),
    "beyan_notu" TEXT,
    "beyan_giren_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vergi_yukumluluk_kayitlari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vergi_yukumluluk_kayitlari_ay_check" CHECK ("ay" BETWEEN 1 AND 12),
    CONSTRAINT "vergi_yukumluluk_kayitlari_tur_check" CHECK ("yukumluluk" IN ('kdv1', 'kdv2', 'muhtasar', 'sgk', 'muhtasar3')),
    CONSTRAINT "vergi_yukumluluk_kayitlari_beyan_check" CHECK ("beyan_tutari" IS NULL OR "beyan_tutari" >= 0),
    CONSTRAINT "vergi_yukumluluk_kayitlari_devreden_check" CHECK ("beyan_devreden" IS NULL OR "beyan_devreden" >= 0)
);
CREATE TABLE "vergi_odemeleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kayit_id" UUID NOT NULL,
    "tarih" DATE NOT NULL,
    "tutar" DECIMAL(15,2) NOT NULL,
    "kasa_banka_hareket_id" UUID,
    "not" TEXT,
    "kullanici_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vergi_odemeleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vergi_odemeleri_tutar_check" CHECK ("tutar" > 0)
);
CREATE UNIQUE INDEX "vergi_yukumluluk_kayitlari_tenant_id_yukumluluk_yil_ay_key" ON "vergi_yukumluluk_kayitlari"("tenant_id", "yukumluluk", "yil", "ay");
CREATE INDEX "vergi_yukumluluk_kayitlari_tenant_id_yil_ay_idx" ON "vergi_yukumluluk_kayitlari"("tenant_id", "yil", "ay");
CREATE UNIQUE INDEX "vergi_odemeleri_kasa_banka_hareket_id_key" ON "vergi_odemeleri"("kasa_banka_hareket_id");
CREATE INDEX "vergi_odemeleri_tenant_id_kayit_id_idx" ON "vergi_odemeleri"("tenant_id", "kayit_id");

ALTER TABLE "vergi_takvimi_ayarlari" ADD CONSTRAINT "vergi_takvimi_ayarlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vergi_yukumluluk_kayitlari" ADD CONSTRAINT "vergi_yukumluluk_kayitlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vergi_odemeleri" ADD CONSTRAINT "vergi_odemeleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vergi_odemeleri" ADD CONSTRAINT "vergi_odemeleri_kayit_id_fkey" FOREIGN KEY ("kayit_id") REFERENCES "vergi_yukumluluk_kayitlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vergi_odemeleri" ADD CONSTRAINT "vergi_odemeleri_kasa_banka_hareket_id_fkey" FOREIGN KEY ("kasa_banka_hareket_id") REFERENCES "kasa_banka_hareketleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vergi_takvimi_ayarlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vergi_takvimi_ayarlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_vergi_takvimi_ayarlari ON "vergi_takvimi_ayarlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "vergi_yukumluluk_kayitlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vergi_yukumluluk_kayitlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_vergi_yukumluluk_kayitlari ON "vergi_yukumluluk_kayitlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "vergi_odemeleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vergi_odemeleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_vergi_odemeleri ON "vergi_odemeleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- SEC-17: bağlı kayıtlar aynı kiracıda olmalı.
CREATE TRIGGER kbag_vergi_odemeleri_kayit_id_fkey AFTER INSERT OR UPDATE OF kayit_id, tenant_id ON "vergi_odemeleri"
  FOR EACH ROW EXECUTE FUNCTION kiraci_bag_denetle('kayit_id', 'vergi_yukumluluk_kayitlari', 'id');
CREATE TRIGGER kbag_vergi_odemeleri_kasa_banka_hareket_id_fkey AFTER INSERT OR UPDATE OF kasa_banka_hareket_id, tenant_id ON "vergi_odemeleri"
  FOR EACH ROW WHEN (NEW.kasa_banka_hareket_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('kasa_banka_hareket_id', 'kasa_banka_hareketleri', 'id');
