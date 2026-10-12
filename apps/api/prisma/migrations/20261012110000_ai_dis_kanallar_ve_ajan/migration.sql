-- Faz 3: Yapay Zeka Dış Kanallar, Oturumlar ve Belge OCR Modelleri

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telefon" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pin_kodu" TEXT;

CREATE TABLE IF NOT EXISTS "ajan_oturumlari" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kanal" TEXT NOT NULL,
    "kanal_kimlik" TEXT NOT NULL,
    "pin_kodu" TEXT,
    "pin_dogrulandi" BOOLEAN NOT NULL DEFAULT false,
    "son_etkilesim" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ajan_oturumlari_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ajan_oturumlari_tenant_id_kanal_kanal_kimlik_key" ON "ajan_oturumlari"("tenant_id", "kanal", "kanal_kimlik");
CREATE INDEX IF NOT EXISTS "ajan_oturumlari_tenant_id_kanal_idx" ON "ajan_oturumlari"("tenant_id", "kanal");

ALTER TABLE "ajan_oturumlari" ADD CONSTRAINT "ajan_oturumlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ajan_oturumlari" ADD CONSTRAINT "ajan_oturumlari_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "ajan_mesaj_gecmisi" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "oturum_id" UUID NOT NULL,
    "rol" TEXT NOT NULL,
    "icerik" TEXT NOT NULL,
    "arac_cagrisi" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ajan_mesaj_gecmisi_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ajan_mesaj_gecmisi_oturum_id_created_at_idx" ON "ajan_mesaj_gecmisi"("oturum_id", "created_at");

ALTER TABLE "ajan_mesaj_gecmisi" ADD CONSTRAINT "ajan_mesaj_gecmisi_oturum_id_fkey" FOREIGN KEY ("oturum_id") REFERENCES "ajan_oturumlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "belge_ocr_kayitlari" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "dosya_yolu" TEXT NOT NULL,
    "belge_turu" TEXT NOT NULL,
    "ham_metin" TEXT,
    "cikarilan_veri" JSONB NOT NULL,
    "durum" TEXT NOT NULL DEFAULT 'BEKLIYOR',
    "kaynak_kayit_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "belge_ocr_kayitlari_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "belge_ocr_kayitlari_tenant_id_durum_idx" ON "belge_ocr_kayitlari"("tenant_id", "durum");

ALTER TABLE "belge_ocr_kayitlari" ADD CONSTRAINT "belge_ocr_kayitlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (Kiracı Yalıtımı)
ALTER TABLE "ajan_oturumlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ajan_oturumlari" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ajan_oturumlari";
CREATE POLICY tenant_isolation ON "ajan_oturumlari"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "ajan_mesaj_gecmisi" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ajan_mesaj_gecmisi" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ajan_mesaj_gecmisi";
CREATE POLICY tenant_isolation ON "ajan_mesaj_gecmisi"
  USING (EXISTS (
    SELECT 1 FROM "ajan_oturumlari" o
    WHERE o."id" = "ajan_mesaj_gecmisi"."oturum_id"
      AND o."tenant_id" = current_setting('app.tenant_id', true)::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "ajan_oturumlari" o
    WHERE o."id" = "ajan_mesaj_gecmisi"."oturum_id"
      AND o."tenant_id" = current_setting('app.tenant_id', true)::uuid
  ));

ALTER TABLE "belge_ocr_kayitlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "belge_ocr_kayitlari" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "belge_ocr_kayitlari";
CREATE POLICY tenant_isolation ON "belge_ocr_kayitlari"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
