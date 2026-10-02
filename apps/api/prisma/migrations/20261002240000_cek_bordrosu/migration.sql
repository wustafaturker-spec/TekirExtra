-- KSB-11: çek/senet bordrosu, bankadaki çekin hesabı ve çek görüntüsü.

CREATE TYPE "CekSenetBordroTur" AS ENUM ('giris', 'ciro', 'tahsile', 'teminata', 'borc_cikis');
CREATE TYPE "CekSenetBordroDurum" AS ENUM ('aktif', 'geri_alindi');
ALTER TYPE "EkSahipTur" ADD VALUE 'cek_senet';

CREATE TABLE "cek_senet_bordrolari" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "no" TEXT NOT NULL,
    "tur" "CekSenetBordroTur" NOT NULL,
    "durum" "CekSenetBordroDurum" NOT NULL DEFAULT 'aktif',
    "tarih" DATE NOT NULL,
    "cari_id" UUID,
    "banka_hesap_id" UUID,
    "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
    "toplam" DECIMAL(15,2) NOT NULL,
    "adet" INTEGER NOT NULL,
    "ortalama_vade" DATE NOT NULL,
    "aciklama" TEXT,
    "user_id" UUID,
    "geri_alma_nedeni" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cek_senet_bordrolari_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cek_senet_bordrolari_tenant_id_no_key" ON "cek_senet_bordrolari"("tenant_id", "no");
CREATE INDEX "cek_senet_bordrolari_tenant_id_tarih_idx" ON "cek_senet_bordrolari"("tenant_id", "tarih");
ALTER TABLE "cek_senet_bordrolari" ADD CONSTRAINT "cek_senet_bordrolari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cek_senet_bordrolari" ADD CONSTRAINT "cek_senet_bordrolari_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cek_senet_bordrolari" ADD CONSTRAINT "cek_senet_bordrolari_banka_hesap_id_fkey" FOREIGN KEY ("banka_hesap_id") REFERENCES "banka_hesaplari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cek_senet_bordrolari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cek_senet_bordrolari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cek_senet_bordrolari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE "cek_senet_bordro_sayaclari" (
    "tenant_id" UUID NOT NULL,
    "yil" INTEGER NOT NULL,
    "son_sira" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "cek_senet_bordro_sayaclari_pkey" PRIMARY KEY ("tenant_id", "yil")
);
ALTER TABLE "cek_senet_bordro_sayaclari" ADD CONSTRAINT "cek_senet_bordro_sayaclari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cek_senet_bordro_sayaclari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cek_senet_bordro_sayaclari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cek_senet_bordro_sayaclari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "cek_senet_olaylari" ADD COLUMN "bordro_id" UUID,
ADD COLUMN "banka_hesap_id" UUID;
ALTER TABLE "cek_senet_olaylari" ADD CONSTRAINT "cek_senet_olaylari_bordro_id_fkey" FOREIGN KEY ("bordro_id") REFERENCES "cek_senet_bordrolari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "cek_senet_olaylari_bordro_id_idx" ON "cek_senet_olaylari"("bordro_id");

ALTER TABLE "cek_senetler" ADD COLUMN "banka_hesap_id" UUID,
ADD COLUMN "on_yuz_ek_id" UUID,
ADD COLUMN "arka_yuz_ek_id" UUID;
ALTER TABLE "cek_senetler" ADD CONSTRAINT "cek_senetler_banka_hesap_id_fkey" FOREIGN KEY ("banka_hesap_id") REFERENCES "banka_hesaplari"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cek_senetler" ADD CONSTRAINT "cek_senetler_on_yuz_ek_id_fkey" FOREIGN KEY ("on_yuz_ek_id") REFERENCES "ekler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cek_senetler" ADD CONSTRAINT "cek_senetler_arka_yuz_ek_id_fkey" FOREIGN KEY ("arka_yuz_ek_id") REFERENCES "ekler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
