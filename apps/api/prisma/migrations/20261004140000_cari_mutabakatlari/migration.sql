-- CARI-42: bakiye mutabakatı talebi ve girişsiz portal yanıtı.

CREATE TABLE "cari_mutabakatlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cari_id" UUID NOT NULL,
    "mutabakat_tarihi" DATE NOT NULL,
    "baslangic_tarihi" DATE,
    "son_yanit_tarihi" DATE NOT NULL,
    "bakiyeler" JSONB NOT NULL,
    "bakiye_try" DECIMAL(15,2) NOT NULL,
    "alici" TEXT NOT NULL,
    "anahtar_ozeti" TEXT NOT NULL,
    "hatirlatma_anahtar_ozeti" TEXT,
    "ekstre_anahtari" TEXT NOT NULL,
    "durum" TEXT NOT NULL DEFAULT 'gonderildi',
    "goruldu_at" TIMESTAMP(3),
    "yanit_at" TIMESTAMP(3),
    "yanitlayan_ad" TEXT,
    "yanitlayan_gorev" TEXT,
    "yanitlayan_eposta" TEXT,
    "yanit_aciklama" TEXT,
    "karsi_bakiyeler" JSONB,
    "ek_anahtari" TEXT,
    "ek_dosya_adi" TEXT,
    "ek_mime" TEXT,
    "yanit_ip" TEXT,
    "yanit_tarayici" TEXT,
    "hatirlatma_at" TIMESTAMP(3),
    "itiraz_kapandi_at" TIMESTAMP(3),
    "itiraz_kapatma_notu" TEXT,
    "itiraz_kapatan_user_id" UUID,
    "iptal_at" TIMESTAMP(3),
    "olusturan_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cari_mutabakatlari_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cari_mutabakatlari_durum_check" CHECK ("durum" IN ('gonderildi', 'goruldu', 'mutabik', 'itiraz', 'iptal')),
    CONSTRAINT "cari_mutabakatlari_tarih_check" CHECK ("son_yanit_tarihi" >= "mutabakat_tarihi" AND ("baslangic_tarihi" IS NULL OR "baslangic_tarihi" <= "mutabakat_tarihi")),
    CONSTRAINT "cari_mutabakatlari_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cari_mutabakatlari_tenant_id_anahtar_ozeti_key" ON "cari_mutabakatlari"("tenant_id", "anahtar_ozeti");
CREATE INDEX "cari_mutabakatlari_tenant_id_cari_id_created_at_idx" ON "cari_mutabakatlari"("tenant_id", "cari_id", "created_at");
CREATE INDEX "cari_mutabakatlari_tenant_id_durum_son_yanit_tarihi_idx" ON "cari_mutabakatlari"("tenant_id", "durum", "son_yanit_tarihi");
CREATE INDEX "cari_mutabakatlari_tenant_id_hatirlatma_anahtar_ozeti_idx" ON "cari_mutabakatlari"("tenant_id", "hatirlatma_anahtar_ozeti");
ALTER TABLE "cari_mutabakatlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cari_mutabakatlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cari_mutabakatlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
