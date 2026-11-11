-- ONY-01…10: genel onay akışları. Kural: işlem × koşul → sıralı adımlar; talep: kurala takılan
-- işlem, son adım onaylayınca talep edenin adına yürütülür.
ALTER TYPE "BildirimTuru" ADD VALUE IF NOT EXISTS 'onay';

CREATE TABLE "onay_kurallari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "islem" VARCHAR(40) NOT NULL,
    "ad" VARCHAR(120) NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "tutar_esigi" DECIMAL(15,2),
    "iskonto_esigi" DECIMAL(5,2),
    "risk_asimi" BOOLEAN NOT NULL DEFAULT false,
    "adimlar" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "onay_kurallari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onay_kurallari_islem_check" CHECK ("islem" IN ('fatura_kesinlestir_satis', 'fatura_kesinlestir_alis', 'belge_onayla_satis', 'masraf_onayla', 'kasa_banka_odeme'))
);
CREATE INDEX "onay_kurallari_tenant_id_islem_idx" ON "onay_kurallari"("tenant_id", "islem");
ALTER TABLE "onay_kurallari" ADD CONSTRAINT "onay_kurallari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "onay_kurallari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onay_kurallari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_onay_kurallari ON "onay_kurallari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE "onay_talepleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kural_id" UUID,
    "islem" VARCHAR(40) NOT NULL,
    "hedef_tur" VARCHAR(30),
    "hedef_id" UUID,
    "hedef_ozeti" VARCHAR(64),
    "parametreler" JSONB NOT NULL,
    "ozet" TEXT NOT NULL,
    "tutar_try" DECIMAL(15,2),
    "nedenler" JSONB NOT NULL,
    "talep_eden_id" UUID NOT NULL,
    "durum" VARCHAR(16) NOT NULL DEFAULT 'bekliyor',
    "adimlar" JSONB NOT NULL,
    "adim" INTEGER NOT NULL DEFAULT 0,
    "kararlar" JSONB NOT NULL DEFAULT '[]',
    "sonuc" JSONB,
    "hata" TEXT,
    "hatirlatildi_at" TIMESTAMP(3),
    "karar_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "onay_talepleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onay_talepleri_durum_check" CHECK ("durum" IN ('bekliyor', 'isleniyor', 'onaylandi', 'reddedildi', 'geri_cekildi', 'gecersiz', 'hata'))
);
CREATE INDEX "onay_talepleri_tenant_id_durum_idx" ON "onay_talepleri"("tenant_id", "durum");
CREATE INDEX "onay_talepleri_tenant_id_hedef_id_idx" ON "onay_talepleri"("tenant_id", "hedef_id");
ALTER TABLE "onay_talepleri" ADD CONSTRAINT "onay_talepleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "onay_talepleri" ADD CONSTRAINT "onay_talepleri_kural_id_fkey" FOREIGN KEY ("kural_id") REFERENCES "onay_kurallari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "onay_talepleri" ADD CONSTRAINT "onay_talepleri_talep_eden_id_fkey" FOREIGN KEY ("talep_eden_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "onay_talepleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onay_talepleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_onay_talepleri ON "onay_talepleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
-- SEC-17: bağlı kural ve kullanıcı aynı kiracıda olmalı.
CREATE TRIGGER kbag_onay_talepleri_kural_id_fkey AFTER INSERT OR UPDATE OF kural_id, tenant_id ON "onay_talepleri"
  FOR EACH ROW WHEN (NEW.kural_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('kural_id', 'onay_kurallari', 'id');
CREATE TRIGGER kbag_onay_talepleri_talep_eden_id_fkey AFTER INSERT OR UPDATE OF talep_eden_id, tenant_id ON "onay_talepleri"
  FOR EACH ROW WHEN (NEW.talep_eden_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('talep_eden_id', 'users', 'id');
