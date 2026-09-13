-- DVZ-01: TCMB kuru herkes için aynıdır; kiracı başına kopyalanmaz. Ortak
-- tablo RLS'sizdir (gib_mukellefler ile aynı gerekçe) ve günde bir kez dolar.
CREATE TABLE "tcmb_kurlari" (
    "tarih" DATE NOT NULL,
    "doviz_cinsi" "DovizCinsi" NOT NULL,
    "doviz_alis" DECIMAL(15,6) NOT NULL,
    "doviz_satis" DECIMAL(15,6) NOT NULL,
    "kaynak" TEXT NOT NULL,
    "alindi_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tcmb_kurlari_pkey" PRIMARY KEY ("tarih", "doviz_cinsi")
);

-- Kiracılara dağılmış mevcut TCMB kayıtları tek kopyaya iner; aynı gün birden
-- çok kiracıda varsa en son alınan kalır.
INSERT INTO "tcmb_kurlari" ("tarih", "doviz_cinsi", "doviz_alis", "doviz_satis", "kaynak", "alindi_at")
SELECT DISTINCT ON ("tarih", "doviz_cinsi") "tarih", "doviz_cinsi", "doviz_alis", "doviz_satis", "kaynak", "alindi_at"
FROM "doviz_kurlari"
ORDER BY "tarih", "doviz_cinsi", "alindi_at" DESC;

-- DVZ-05: kiracının elle girdiği kur; o kiracıda aynı günün TCMB kurunun yerine geçer.
CREATE TYPE "ElleKurOlayTuru" AS ENUM ('girildi', 'degistirildi', 'silindi');

CREATE TABLE "elle_kurlar" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tarih" DATE NOT NULL,
    "doviz_cinsi" "DovizCinsi" NOT NULL,
    "doviz_alis" DECIMAL(15,6) NOT NULL,
    "doviz_satis" DECIMAL(15,6) NOT NULL,
    "gerekce" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "elle_kurlar_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "elle_kurlar_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "elle_kurlar_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "elle_kurlar_tenant_id_tarih_doviz_cinsi_key" ON "elle_kurlar"("tenant_id", "tarih", "doviz_cinsi");

ALTER TABLE "elle_kurlar" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "elle_kurlar" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_elle_kurlar" ON "elle_kurlar" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Olay geçmişi elle kura bağlanmaz: silinen kurun izi de kalmalıdır.
CREATE TABLE "elle_kur_olaylari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tarih" DATE NOT NULL,
    "doviz_cinsi" "DovizCinsi" NOT NULL,
    "tur" "ElleKurOlayTuru" NOT NULL,
    "eski_alis" DECIMAL(15,6),
    "eski_satis" DECIMAL(15,6),
    "yeni_alis" DECIMAL(15,6),
    "yeni_satis" DECIMAL(15,6),
    "gerekce" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "elle_kur_olaylari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "elle_kur_olaylari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "elle_kur_olaylari_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "elle_kur_olaylari_tenant_id_created_at_idx" ON "elle_kur_olaylari"("tenant_id", "created_at");

ALTER TABLE "elle_kur_olaylari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "elle_kur_olaylari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_elle_kur_olaylari" ON "elle_kur_olaylari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Kiracı başına kopyalar ortak tabloya taşındı.
DROP TABLE "doviz_kurlari";
