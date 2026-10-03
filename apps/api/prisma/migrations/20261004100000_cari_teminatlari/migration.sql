-- CARI-39: müşteriden alınan teminatlar (mektup, ipotek, DBS, nakit, kefalet, diğer).

CREATE TABLE "cari_teminatlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cari_id" UUID NOT NULL,
    "tur" TEXT NOT NULL,
    "tutar" DECIMAL(15,2) NOT NULL,
    "doviz_cinsi" "DovizCinsi" NOT NULL DEFAULT 'TRY',
    "banka" TEXT,
    "belge_no" TEXT,
    "baslangic_tarihi" DATE,
    "bitis_tarihi" DATE,
    "aciklama" TEXT,
    "durum" TEXT NOT NULL DEFAULT 'aktif',
    "iade_tarihi" DATE,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cari_teminatlari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cari_teminatlari_tur_check" CHECK ("tur" IN ('teminat_mektubu', 'ipotek', 'dbs', 'nakit', 'kefalet', 'diger')),
    CONSTRAINT "cari_teminatlari_durum_check" CHECK ("durum" IN ('aktif', 'iade_edildi')),
    CONSTRAINT "cari_teminatlari_tutar_check" CHECK ("tutar" > 0),
    CONSTRAINT "cari_teminatlari_tarih_check" CHECK ("bitis_tarihi" IS NULL OR "baslangic_tarihi" IS NULL OR "bitis_tarihi" >= "baslangic_tarihi"),
    CONSTRAINT "cari_teminatlari_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "cari_teminatlari_tenant_id_cari_id_idx" ON "cari_teminatlari"("tenant_id", "cari_id");
CREATE INDEX "cari_teminatlari_tenant_id_durum_bitis_tarihi_idx" ON "cari_teminatlari"("tenant_id", "durum", "bitis_tarihi");
ALTER TABLE "cari_teminatlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cari_teminatlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cari_teminatlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
