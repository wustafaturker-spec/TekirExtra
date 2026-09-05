-- BLD-01..BLD-10: kalıcı bildirim ve sahiplenme katmanı.
--
-- Zil menüsü bugüne dek iki API özetini tarayıcıda birleştiriyordu; kayıt
-- tutulmadığı için bir olayın kullanıcıya ulaştığı ve sahiplenildiği
-- kanıtlanamıyordu. Bildirim olayın kendisini, teslimat ise olayın tek bir
-- kullanıcıdaki durumunu tutar.
CREATE TYPE "BildirimTuru" AS ENUM ('duzeltme', 'ebelge', 'vade', 'cek_senet', 'stok', 'donem', 'entegrasyon');
CREATE TYPE "BildirimOnemi" AS ENUM ('bilgi', 'uyari', 'kritik');
CREATE TYPE "BildirimTeslimatDurumu" AS ENUM ('yeni', 'okundu', 'ustlenildi', 'aksiyon_alindi', 'yoksayildi');
CREATE TYPE "BildirimKanalDurumu" AS ENUM ('beklemede', 'gonderildi', 'hata', 'kapali');

CREATE TABLE "bildirimler" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "tur" "BildirimTuru" NOT NULL,
  "onem" "BildirimOnemi" NOT NULL DEFAULT 'uyari',
  "baslik" TEXT NOT NULL,
  "aciklama" TEXT NOT NULL,
  "kaynak_tur" TEXT,
  "kaynak_ref" TEXT,
  "hedef_yol" TEXT,
  "birlesim_anahtari" TEXT NOT NULL,
  "son_tarih" TIMESTAMP(3),
  "yukseltildi_at" TIMESTAMP(3),
  "kapandi_at" TIMESTAMP(3),
  "son_tespit_tarihi" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bildirimler_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bildirim_teslimatlari" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "bildirim_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "durum" "BildirimTeslimatDurumu" NOT NULL DEFAULT 'yeni',
  "okundu_at" TIMESTAMP(3),
  "ustlenildi_at" TIMESTAMP(3),
  "aksiyon_at" TIMESTAMP(3),
  "aksiyon_notu" TEXT,
  "eposta_durumu" "BildirimKanalDurumu" NOT NULL DEFAULT 'beklemede',
  "eposta_gonderildi_at" TIMESTAMP(3),
  "eposta_deneme_sayisi" INTEGER NOT NULL DEFAULT 0,
  "eposta_hatasi" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bildirim_teslimatlari_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bildirim_tercihleri" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "tur" "BildirimTuru" NOT NULL,
  "uygulama_ici" BOOLEAN NOT NULL DEFAULT true,
  "eposta" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bildirim_tercihleri_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bildirim_kullanici_ayarlari" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "sessiz_baslangic" TEXT,
  "sessiz_bitis" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bildirim_kullanici_ayarlari_pkey" PRIMARY KEY ("id")
);

-- Aynı kaynak kayıt için ikinci bildirim üretilmemesini garanti eder (BLD-03).
CREATE UNIQUE INDEX "bildirimler_tenant_id_birlesim_anahtari_key" ON "bildirimler"("tenant_id", "birlesim_anahtari");
CREATE INDEX "bildirimler_tenant_id_kapandi_at_onem_created_at_idx" ON "bildirimler"("tenant_id", "kapandi_at", "onem", "created_at");
CREATE INDEX "bildirimler_tenant_id_tur_kapandi_at_idx" ON "bildirimler"("tenant_id", "tur", "kapandi_at");
CREATE UNIQUE INDEX "bildirim_teslimatlari_bildirim_id_user_id_key" ON "bildirim_teslimatlari"("bildirim_id", "user_id");
CREATE INDEX "bildirim_teslimatlari_tenant_id_user_id_durum_idx" ON "bildirim_teslimatlari"("tenant_id", "user_id", "durum");
CREATE INDEX "bildirim_teslimatlari_tenant_id_eposta_durumu_idx" ON "bildirim_teslimatlari"("tenant_id", "eposta_durumu");
CREATE UNIQUE INDEX "bildirim_tercihleri_tenant_id_user_id_tur_key" ON "bildirim_tercihleri"("tenant_id", "user_id", "tur");
CREATE UNIQUE INDEX "bildirim_kullanici_ayarlari_user_id_key" ON "bildirim_kullanici_ayarlari"("user_id");
CREATE UNIQUE INDEX "bildirim_kullanici_ayarlari_tenant_id_user_id_key" ON "bildirim_kullanici_ayarlari"("tenant_id", "user_id");

ALTER TABLE "bildirimler" ADD CONSTRAINT "bildirimler_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bildirim_teslimatlari" ADD CONSTRAINT "bildirim_teslimatlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bildirim_teslimatlari" ADD CONSTRAINT "bildirim_teslimatlari_bildirim_id_fkey" FOREIGN KEY ("bildirim_id") REFERENCES "bildirimler"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bildirim_teslimatlari" ADD CONSTRAINT "bildirim_teslimatlari_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bildirim_tercihleri" ADD CONSTRAINT "bildirim_tercihleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bildirim_tercihleri" ADD CONSTRAINT "bildirim_tercihleri_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bildirim_kullanici_ayarlari" ADD CONSTRAINT "bildirim_kullanici_ayarlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bildirim_kullanici_ayarlari" ADD CONSTRAINT "bildirim_kullanici_ayarlari_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bildirimler" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bildirimler" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_bildirimler" ON "bildirimler" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "bildirim_teslimatlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bildirim_teslimatlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_bildirim_teslimatlari" ON "bildirim_teslimatlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "bildirim_tercihleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bildirim_tercihleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_bildirim_tercihleri" ON "bildirim_tercihleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "bildirim_kullanici_ayarlari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bildirim_kullanici_ayarlari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_bildirim_kullanici_ayarlari" ON "bildirim_kullanici_ayarlari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
