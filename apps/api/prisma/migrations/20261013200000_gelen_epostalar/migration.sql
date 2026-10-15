-- Inbound E-posta (IMAP gelen kutusu, ekler ve cari eşleme)
CREATE TABLE "gelen_epostalar" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "mesaj_id" TEXT NOT NULL,
    "uid" INTEGER,
    "gonderen_adi" TEXT,
    "gonderen_eposta" TEXT NOT NULL,
    "alici_eposta" TEXT NOT NULL,
    "konu" TEXT NOT NULL,
    "icerik_metin" TEXT,
    "icerik_html" TEXT,
    "tarih" TIMESTAMP(3) NOT NULL,
    "okundu" BOOLEAN NOT NULL DEFAULT false,
    "durum" TEXT NOT NULL DEFAULT 'yeni',
    "cari_id" UUID,
    "crm_firsat_id" UUID,
    "fatura_id" UUID,
    "masraf_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gelen_epostalar_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gelen_eposta_ekleri" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "eposta_id" UUID NOT NULL,
    "dosya_adi" TEXT NOT NULL,
    "mime_turu" TEXT NOT NULL,
    "boyut" INTEGER NOT NULL,
    "minio_anahtari" TEXT NOT NULL,
    "cikarilan_veri" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gelen_eposta_ekleri_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gelen_epostalar_tenant_id_mesaj_id_key" ON "gelen_epostalar"("tenant_id", "mesaj_id");
CREATE INDEX "gelen_epostalar_tenant_id_tarih_idx" ON "gelen_epostalar"("tenant_id", "tarih");
CREATE INDEX "gelen_epostalar_tenant_id_gonderen_eposta_idx" ON "gelen_epostalar"("tenant_id", "gonderen_eposta");
CREATE INDEX "gelen_epostalar_tenant_id_durum_idx" ON "gelen_epostalar"("tenant_id", "durum");

CREATE INDEX "gelen_eposta_ekleri_tenant_id_eposta_id_idx" ON "gelen_eposta_ekleri"("tenant_id", "eposta_id");

ALTER TABLE "gelen_epostalar" ADD CONSTRAINT "gelen_epostalar_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gelen_epostalar" ADD CONSTRAINT "gelen_epostalar_cari_id_fkey" FOREIGN KEY ("cari_id") REFERENCES "cari_hesaplar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "gelen_eposta_ekleri" ADD CONSTRAINT "gelen_eposta_ekleri_eposta_id_fkey" FOREIGN KEY ("eposta_id") REFERENCES "gelen_epostalar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gelen_epostalar" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_gelen_epostalar ON "gelen_epostalar" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "gelen_eposta_ekleri" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_gelen_eposta_ekleri ON "gelen_eposta_ekleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
