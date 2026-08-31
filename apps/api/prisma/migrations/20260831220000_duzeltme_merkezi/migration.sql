CREATE TYPE "DuzeltmeDurumu" AS ENUM ('acik', 'incelemede', 'beklemede', 'cozuldu', 'yoksayildi');
CREATE TYPE "DuzeltmeOnemi" AS ENUM ('bilgi', 'uyari', 'kritik');
CREATE TYPE "DuzeltmeTuru" AS ENUM ('banka_ekstre', 'kredi_karti', 'masraf', 'pos', 'ebelge', 'stok', 'cek_senet', 'fatura_cari');

CREATE TABLE "duzeltme_kayitlari" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "tur" "DuzeltmeTuru" NOT NULL,
  "onem" "DuzeltmeOnemi" NOT NULL DEFAULT 'uyari',
  "durum" "DuzeltmeDurumu" NOT NULL DEFAULT 'acik',
  "kaynak_tur" TEXT NOT NULL,
  "kaynak_ref" TEXT NOT NULL,
  "neden_kodu" TEXT NOT NULL,
  "tekillik_anahtari" TEXT,
  "aciklama" TEXT NOT NULL,
  "onerilen_eylem" TEXT,
  "atanan_user_id" UUID,
  "son_tarih" TIMESTAMP(3),
  "cozen_user_id" UUID,
  "cozulme_tarihi" TIMESTAMP(3),
  "son_tespit_tarihi" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "duzeltme_kayitlari_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "duzeltme_olaylari" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "duzeltme_kaydi_id" UUID NOT NULL,
  "user_id" UUID,
  "onceki_durum" "DuzeltmeDurumu",
  "yeni_durum" "DuzeltmeDurumu",
  "olay_turu" TEXT NOT NULL,
  "aciklama" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "duzeltme_olaylari_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "duzeltme_kayitlari_tenant_id_tekillik_anahtari_key" ON "duzeltme_kayitlari"("tenant_id", "tekillik_anahtari");
CREATE INDEX "duzeltme_kayitlari_tenant_id_durum_onem_created_at_idx" ON "duzeltme_kayitlari"("tenant_id", "durum", "onem", "created_at");
CREATE INDEX "duzeltme_kayitlari_tenant_id_atanan_user_id_durum_idx" ON "duzeltme_kayitlari"("tenant_id", "atanan_user_id", "durum");
CREATE INDEX "duzeltme_kayitlari_tenant_id_tur_durum_idx" ON "duzeltme_kayitlari"("tenant_id", "tur", "durum");
CREATE INDEX "duzeltme_olaylari_tenant_id_duzeltme_kaydi_id_created_at_idx" ON "duzeltme_olaylari"("tenant_id", "duzeltme_kaydi_id", "created_at");

ALTER TABLE "duzeltme_kayitlari" ADD CONSTRAINT "duzeltme_kayitlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "duzeltme_kayitlari" ADD CONSTRAINT "duzeltme_kayitlari_atanan_user_id_fkey" FOREIGN KEY ("atanan_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "duzeltme_kayitlari" ADD CONSTRAINT "duzeltme_kayitlari_cozen_user_id_fkey" FOREIGN KEY ("cozen_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "duzeltme_olaylari" ADD CONSTRAINT "duzeltme_olaylari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "duzeltme_olaylari" ADD CONSTRAINT "duzeltme_olaylari_duzeltme_kaydi_id_fkey" FOREIGN KEY ("duzeltme_kaydi_id") REFERENCES "duzeltme_kayitlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "duzeltme_olaylari" ADD CONSTRAINT "duzeltme_olaylari_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "duzeltme_kayitlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "duzeltme_kayitlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_duzeltme_kayitlari" ON "duzeltme_kayitlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "duzeltme_olaylari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "duzeltme_olaylari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_duzeltme_olaylari" ON "duzeltme_olaylari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
