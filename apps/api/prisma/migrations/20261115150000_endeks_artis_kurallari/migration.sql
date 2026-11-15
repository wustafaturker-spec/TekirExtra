-- END-17: kira sözleşmesi ve tekrarlayan faturada endeksli artış kuralı ve önerisi.
-- Kural kayıt başına tektir; artış ayı gelince worker öneri üretir, kullanıcı onaylayınca
-- kira matrahı ya da tekrarlayan planın fiyat çarpanı güncellenir. Kendiliğinden bedel değişmez.

-- Tekrarlayan plan şablonu çoğunlukla kesin faturadır ve değiştirilemez; artış çarpanla taşınır.
ALTER TABLE "tekrarlayan_faturalar" ADD COLUMN "fiyat_carpani" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "tekrarlayan_faturalar" ADD CONSTRAINT "tekrarlayan_faturalar_fiyat_carpani_pozitif" CHECK ("fiyat_carpani" > 0);

CREATE TABLE "endeks_artis_kurallari" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kira_sozlesme_id" UUID,
    "tekrarlayan_fatura_id" UUID,
    "seri_kodu" VARCHAR(40) NOT NULL,
    "olcu" VARCHAR(20) NOT NULL,
    "artis_ayi" INTEGER NOT NULL,
    "ust_sinir" DECIMAL(7,2),
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "endeks_artis_kurallari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "endeks_artis_kurallari_tek_kaynak" CHECK (num_nonnulls("kira_sozlesme_id", "tekrarlayan_fatura_id") = 1),
    CONSTRAINT "endeks_artis_kurallari_olcu_gecerli" CHECK ("olcu" IN ('yillik', 'oniki_ay_ortalama')),
    CONSTRAINT "endeks_artis_kurallari_ay_gecerli" CHECK ("artis_ayi" BETWEEN 1 AND 12),
    CONSTRAINT "endeks_artis_kurallari_sinir_gecerli" CHECK ("ust_sinir" IS NULL OR "ust_sinir" BETWEEN 0 AND 1000)
);
CREATE UNIQUE INDEX "endeks_artis_kurallari_kira_sozlesme_id_key" ON "endeks_artis_kurallari"("kira_sozlesme_id");
CREATE UNIQUE INDEX "endeks_artis_kurallari_tekrarlayan_fatura_id_key" ON "endeks_artis_kurallari"("tekrarlayan_fatura_id");
CREATE INDEX "endeks_artis_kurallari_tenant_id_aktif_artis_ayi_idx" ON "endeks_artis_kurallari"("tenant_id", "aktif", "artis_ayi");
ALTER TABLE "endeks_artis_kurallari" ADD CONSTRAINT "endeks_artis_kurallari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "endeks_artis_kurallari" ADD CONSTRAINT "endeks_artis_kurallari_kira_sozlesme_id_fkey" FOREIGN KEY ("kira_sozlesme_id") REFERENCES "kira_sozlesmeleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "endeks_artis_kurallari" ADD CONSTRAINT "endeks_artis_kurallari_tekrarlayan_fatura_id_fkey" FOREIGN KEY ("tekrarlayan_fatura_id") REFERENCES "tekrarlayan_faturalar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "endeks_artis_kurallari" ADD CONSTRAINT "endeks_artis_kurallari_seri_kodu_fkey" FOREIGN KEY ("seri_kodu") REFERENCES "endeks_serileri"("kod") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "endeks_artis_kurallari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "endeks_artis_kurallari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_endeks_artis_kurallari ON "endeks_artis_kurallari"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
-- SEC-17: bağlı kayıt aynı kiracıda olmalı.
CREATE TRIGGER kbag_endeks_artis_kurallari_kira_sozlesme_id_fkey AFTER INSERT OR UPDATE OF kira_sozlesme_id, tenant_id ON "endeks_artis_kurallari"
  FOR EACH ROW WHEN (NEW.kira_sozlesme_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('kira_sozlesme_id', 'kira_sozlesmeleri', 'id');
CREATE TRIGGER kbag_endeks_artis_kurallari_tekrarlayan_fatura_id_fkey AFTER INSERT OR UPDATE OF tekrarlayan_fatura_id, tenant_id ON "endeks_artis_kurallari"
  FOR EACH ROW WHEN (NEW.tekrarlayan_fatura_id IS NOT NULL) EXECUTE FUNCTION kiraci_bag_denetle('tekrarlayan_fatura_id', 'tekrarlayan_faturalar', 'id');

CREATE TABLE "endeks_artis_onerileri" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "kural_id" UUID NOT NULL,
    "yil" INTEGER NOT NULL,
    "seri_kodu" VARCHAR(40) NOT NULL,
    "olcu" VARCHAR(20) NOT NULL,
    "son_ay" DATE NOT NULL,
    "hesaplanan_oran" DECIMAL(9,2) NOT NULL,
    "uygulanan_oran" DECIMAL(9,2) NOT NULL,
    "eski_bedel" DECIMAL(18,8) NOT NULL,
    "yeni_bedel" DECIMAL(18,8) NOT NULL,
    "hesap" JSONB NOT NULL,
    "durum" VARCHAR(12) NOT NULL DEFAULT 'bekliyor',
    "karar_veren_id" UUID,
    "karar_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "endeks_artis_onerileri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "endeks_artis_onerileri_durum_gecerli" CHECK ("durum" IN ('bekliyor', 'onaylandi', 'reddedildi'))
);
CREATE UNIQUE INDEX "endeks_artis_onerileri_kural_id_yil_key" ON "endeks_artis_onerileri"("kural_id", "yil");
CREATE INDEX "endeks_artis_onerileri_tenant_id_durum_idx" ON "endeks_artis_onerileri"("tenant_id", "durum");
ALTER TABLE "endeks_artis_onerileri" ADD CONSTRAINT "endeks_artis_onerileri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "endeks_artis_onerileri" ADD CONSTRAINT "endeks_artis_onerileri_kural_id_fkey" FOREIGN KEY ("kural_id") REFERENCES "endeks_artis_kurallari"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "endeks_artis_onerileri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "endeks_artis_onerileri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_endeks_artis_onerileri ON "endeks_artis_onerileri"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE TRIGGER kbag_endeks_artis_onerileri_kural_id_fkey AFTER INSERT OR UPDATE OF kural_id, tenant_id ON "endeks_artis_onerileri"
  FOR EACH ROW EXECUTE FUNCTION kiraci_bag_denetle('kural_id', 'endeks_artis_kurallari', 'id');
-- Öneri silinmez; karar verilmiş öneri değişmez.
REVOKE DELETE ON "endeks_artis_onerileri" FROM tekir_app;
CREATE OR REPLACE FUNCTION endeks_artis_onerisi_koru() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.durum <> 'bekliyor' THEN RAISE EXCEPTION 'Karar verilmiş artış önerisi değiştirilemez'; END IF;
  IF NEW.eski_bedel IS DISTINCT FROM OLD.eski_bedel OR NEW.yeni_bedel IS DISTINCT FROM OLD.yeni_bedel OR NEW.uygulanan_oran IS DISTINCT FROM OLD.uygulanan_oran
    OR NEW.hesap IS DISTINCT FROM OLD.hesap OR NEW.kural_id IS DISTINCT FROM OLD.kural_id OR NEW.yil IS DISTINCT FROM OLD.yil THEN
    RAISE EXCEPTION 'Artış önerisinin hesabı değiştirilemez';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER endeks_artis_onerisi_koru BEFORE UPDATE ON "endeks_artis_onerileri"
  FOR EACH ROW EXECUTE FUNCTION endeks_artis_onerisi_koru();
