-- Bütçe (BUT-05…BUT-08): yıllık, aylara dağıtılmış, taslak → onay → revizyon.
-- Satır anahtarı gelir-gider raporuyla aynı tahakkuk kalemidir, böylece
-- gerçekleşen bütçeyle birebir eşleşir.
CREATE TYPE "ButceDurumu" AS ENUM ('taslak', 'onayli', 'yerine_gecildi');
CREATE TYPE "ButceOlayTuru" AS ENUM ('olusturuldu', 'onaylandi', 'revizyon_acildi');

CREATE TABLE "butceler" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "yil" INTEGER NOT NULL,
  "revizyon" INTEGER NOT NULL,
  "durum" "ButceDurumu" NOT NULL DEFAULT 'taslak',
  "gerekce" TEXT,
  "onaylayan_user_id" UUID,
  "onay_tarihi" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "butceler_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "butceler_tenant_id_yil_revizyon_key" ON "butceler"("tenant_id", "yil", "revizyon");
CREATE INDEX "butceler_tenant_id_yil_idx" ON "butceler"("tenant_id", "yil");
-- Aynı yıl için aynı anda tek taslak (BUT-06); iki sekmeden eşzamanlı revizyon açılamaz.
CREATE UNIQUE INDEX "butceler_yil_tek_taslak" ON "butceler"("tenant_id", "yil") WHERE "durum" = 'taslak';
ALTER TABLE "butceler" ADD CONSTRAINT "butceler_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "butceler" ADD CONSTRAINT "butceler_onaylayan_user_id_fkey" FOREIGN KEY ("onaylayan_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "butce_satirlari" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "butce_id" UUID NOT NULL,
  "anahtar" TEXT NOT NULL,
  "ay" INTEGER NOT NULL,
  "tutar" DECIMAL(15,2) NOT NULL,
  CONSTRAINT "butce_satirlari_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "butce_satirlari_ay_check" CHECK ("ay" BETWEEN 1 AND 12),
  CONSTRAINT "butce_satirlari_tutar_check" CHECK ("tutar" >= 0)
);
CREATE UNIQUE INDEX "butce_satirlari_butce_id_anahtar_ay_key" ON "butce_satirlari"("butce_id", "anahtar", "ay");
ALTER TABLE "butce_satirlari" ADD CONSTRAINT "butce_satirlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "butce_satirlari" ADD CONSTRAINT "butce_satirlari_butce_id_fkey" FOREIGN KEY ("butce_id") REFERENCES "butceler"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "butce_olaylari" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "butce_id" UUID NOT NULL,
  "tur" "ButceOlayTuru" NOT NULL,
  "gerekce" TEXT,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "butce_olaylari_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "butce_olaylari_tenant_id_butce_id_created_at_idx" ON "butce_olaylari"("tenant_id", "butce_id", "created_at");
ALTER TABLE "butce_olaylari" ADD CONSTRAINT "butce_olaylari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "butce_olaylari" ADD CONSTRAINT "butce_olaylari_butce_id_fkey" FOREIGN KEY ("butce_id") REFERENCES "butceler"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "butce_olaylari" ADD CONSTRAINT "butce_olaylari_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "butceler" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "butceler" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_butceler" ON "butceler" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "butce_satirlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "butce_satirlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_butce_satirlari" ON "butce_satirlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "butce_olaylari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "butce_olaylari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_butce_olaylari" ON "butce_olaylari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
