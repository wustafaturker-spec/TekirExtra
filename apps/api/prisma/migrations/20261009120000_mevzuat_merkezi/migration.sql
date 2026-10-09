-- MVZ (Mevzuat Merkezi, 2026-10-09): merkezi, yürürlük tarihli mevzuat tabloları.
-- Kiracıya ait değildir (RLS yok); uygulama rolü okur, platform rolü yazar (MVZ-16).

-- CreateEnum
CREATE TYPE "MevzuatDegisiklikDurum" AS ENUM ('taslak', 'onay_bekliyor', 'yayinlandi');

-- CreateEnum
CREATE TYPE "MevzuatIslem" AS ENUM ('ekle', 'degistir', 'kaldir');

-- CreateEnum
CREATE TYPE "MevzuatTalepKaynagi" AS ENUM ('kiraci_bildirimi', 'bilinmeyen_kod');

-- CreateEnum
CREATE TYPE "MevzuatTalepDurumu" AS ENUM ('acik', 'cozuldu', 'reddedildi');

-- AlterEnum
ALTER TYPE "BildirimTuru" ADD VALUE 'mevzuat';

-- CreateTable
CREATE TABLE "platform_kullanicilari" (
    "id" UUID NOT NULL,
    "eposta" TEXT NOT NULL,
    "ad_soyad" TEXT NOT NULL,
    "parola_hash" TEXT NOT NULL,
    "totp_secret_sifreli" TEXT NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "son_giris" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_kullanicilari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mevzuat_degisiklikleri" (
    "id" UUID NOT NULL,
    "no" SERIAL NOT NULL,
    "baslik" TEXT NOT NULL,
    "dayanak" TEXT NOT NULL,
    "aciklama" TEXT,
    "yururluk_baslangic" DATE NOT NULL,
    "durum" "MevzuatDegisiklikDurum" NOT NULL DEFAULT 'taslak',
    "hazirlayan_id" UUID NOT NULL,
    "yayinlayan_id" UUID,
    "onaya_gonderim_zamani" TIMESTAMP(3),
    "yayin_zamani" TIMESTAMP(3),
    "ret_gerekcesi" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mevzuat_degisiklikleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mevzuat_degisiklik_satirlari" (
    "id" UUID NOT NULL,
    "degisiklik_id" UUID NOT NULL,
    "sira" INTEGER NOT NULL,
    "tur" TEXT NOT NULL,
    "anahtar" TEXT NOT NULL,
    "islem" "MevzuatIslem" NOT NULL,
    "deger" JSONB,

    CONSTRAINT "mevzuat_degisiklik_satirlari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mevzuat_kayitlari" (
    "id" UUID NOT NULL,
    "tur" TEXT NOT NULL,
    "anahtar" TEXT NOT NULL,
    "deger" JSONB NOT NULL,
    "yururluk_baslangic" DATE NOT NULL,
    "yururluk_bitis" DATE,
    "degisiklik_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mevzuat_kayitlari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mevzuat_olaylari" (
    "id" UUID NOT NULL,
    "degisiklik_id" UUID,
    "kullanici_id" UUID,
    "olay" TEXT NOT NULL,
    "detay" JSONB,
    "zaman" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mevzuat_olaylari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mevzuat_talepleri" (
    "id" UUID NOT NULL,
    "kaynak" "MevzuatTalepKaynagi" NOT NULL,
    "tenant_id" UUID,
    "tur" TEXT,
    "anahtar" TEXT,
    "aciklama" TEXT NOT NULL,
    "gorulme_sayisi" INTEGER NOT NULL DEFAULT 1,
    "durum" "MevzuatTalepDurumu" NOT NULL DEFAULT 'acik',
    "cozum_notu" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mevzuat_talepleri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_kullanicilari_eposta_key" ON "platform_kullanicilari"("eposta");

-- CreateIndex
CREATE UNIQUE INDEX "mevzuat_degisiklikleri_no_key" ON "mevzuat_degisiklikleri"("no");

-- CreateIndex
CREATE INDEX "mevzuat_degisiklikleri_durum_yayin_zamani_idx" ON "mevzuat_degisiklikleri"("durum", "yayin_zamani");

-- CreateIndex
CREATE UNIQUE INDEX "mevzuat_degisiklik_satirlari_degisiklik_id_tur_anahtar_key" ON "mevzuat_degisiklik_satirlari"("degisiklik_id", "tur", "anahtar");

-- CreateIndex
CREATE INDEX "mevzuat_kayitlari_tur_anahtar_yururluk_baslangic_idx" ON "mevzuat_kayitlari"("tur", "anahtar", "yururluk_baslangic");

-- CreateIndex
CREATE INDEX "mevzuat_olaylari_degisiklik_id_zaman_idx" ON "mevzuat_olaylari"("degisiklik_id", "zaman");

-- CreateIndex
CREATE INDEX "mevzuat_olaylari_zaman_idx" ON "mevzuat_olaylari"("zaman");

-- CreateIndex
CREATE INDEX "mevzuat_talepleri_durum_created_at_idx" ON "mevzuat_talepleri"("durum", "created_at");

-- AddForeignKey
ALTER TABLE "mevzuat_degisiklikleri" ADD CONSTRAINT "mevzuat_degisiklikleri_hazirlayan_id_fkey" FOREIGN KEY ("hazirlayan_id") REFERENCES "platform_kullanicilari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mevzuat_degisiklikleri" ADD CONSTRAINT "mevzuat_degisiklikleri_yayinlayan_id_fkey" FOREIGN KEY ("yayinlayan_id") REFERENCES "platform_kullanicilari"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mevzuat_degisiklik_satirlari" ADD CONSTRAINT "mevzuat_degisiklik_satirlari_degisiklik_id_fkey" FOREIGN KEY ("degisiklik_id") REFERENCES "mevzuat_degisiklikleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mevzuat_kayitlari" ADD CONSTRAINT "mevzuat_kayitlari_degisiklik_id_fkey" FOREIGN KEY ("degisiklik_id") REFERENCES "mevzuat_degisiklikleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mevzuat_olaylari" ADD CONSTRAINT "mevzuat_olaylari_degisiklik_id_fkey" FOREIGN KEY ("degisiklik_id") REFERENCES "mevzuat_degisiklikleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Yetkiler (MVZ-16) ───────────────────────────────────────────────────
-- Platform rolü yalnız mevzuat tablolarına erişir; kiracı tablolarında hiçbir
-- yetkisi yoktur. Üretimde parolası güçlü bir değerle değiştirilmelidir.
DO $$
BEGIN
  CREATE ROLE tekir_platform LOGIN PASSWORD 'tekir_platform_dev';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
GRANT USAGE ON SCHEMA public TO tekir_platform;

-- Varsayılan yetkiler tekir_app'e tam DML verir; mevzuat tablolarında geri alınır.
REVOKE ALL ON "platform_kullanicilari", "mevzuat_degisiklikleri", "mevzuat_degisiklik_satirlari",
  "mevzuat_kayitlari", "mevzuat_olaylari", "mevzuat_talepleri" FROM tekir_app;
REVOKE ALL ON SEQUENCE "mevzuat_degisiklikleri_no_seq" FROM tekir_app;
-- Kiracı tarafı: yürürlükteki değerleri ve yayınlanan değişiklikleri okur,
-- "eksik/hatalı bildir" ve bilinmeyen kod talebi ekler.
GRANT SELECT ON "mevzuat_degisiklikleri", "mevzuat_degisiklik_satirlari", "mevzuat_kayitlari" TO tekir_app;
GRANT INSERT ON "mevzuat_talepleri" TO tekir_app;

GRANT SELECT, INSERT, UPDATE ON "platform_kullanicilari" TO tekir_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON "mevzuat_degisiklikleri", "mevzuat_degisiklik_satirlari" TO tekir_platform;
GRANT SELECT, INSERT, UPDATE ON "mevzuat_kayitlari" TO tekir_platform;
GRANT SELECT, INSERT ON "mevzuat_olaylari" TO tekir_platform;
GRANT SELECT, UPDATE ON "mevzuat_talepleri" TO tekir_platform;
GRANT USAGE ON SEQUENCE "mevzuat_degisiklikleri_no_seq" TO tekir_platform;

-- ─── Değişmezlik (MVZ-05/08) ─────────────────────────────────────────────
-- Yayınlanan değişiklik ve satırları değiştirilemez, silinemez.
CREATE FUNCTION mevzuat_yayinlanan_degismez() RETURNS trigger AS $$
BEGIN
  IF OLD.durum = 'yayinlandi' THEN
    RAISE EXCEPTION 'Yayınlanan mevzuat değişikliği değiştirilemez (MVZ-05)';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER mevzuat_degisiklik_degismez BEFORE UPDATE OR DELETE ON "mevzuat_degisiklikleri"
  FOR EACH ROW EXECUTE FUNCTION mevzuat_yayinlanan_degismez();

CREATE FUNCTION mevzuat_satir_degismez() RETURNS trigger AS $$
DECLARE d "MevzuatDegisiklikDurum";
BEGIN
  SELECT durum INTO d FROM "mevzuat_degisiklikleri" WHERE id = COALESCE(NEW.degisiklik_id, OLD.degisiklik_id);
  IF d = 'yayinlandi' THEN
    RAISE EXCEPTION 'Yayınlanan mevzuat değişikliğinin satırları değiştirilemez (MVZ-05)';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER mevzuat_satir_degismez BEFORE INSERT OR UPDATE OR DELETE ON "mevzuat_degisiklik_satirlari"
  FOR EACH ROW EXECUTE FUNCTION mevzuat_satir_degismez();

-- Yürürlükteki kayıtta yalnız açık bitiş bir kez kapatılabilir; değer ve
-- başlangıç değişmez (düzeltme yeni kayıtla yapılır).
CREATE FUNCTION mevzuat_kayit_degismez() RETURNS trigger AS $$
BEGIN
  IF OLD.yururluk_bitis IS NOT NULL
     OR NEW.tur <> OLD.tur OR NEW.anahtar <> OLD.anahtar OR NEW.deger <> OLD.deger
     OR NEW.yururluk_baslangic <> OLD.yururluk_baslangic
     OR NEW.degisiklik_id IS DISTINCT FROM OLD.degisiklik_id
     OR NEW.yururluk_bitis < NEW.yururluk_baslangic THEN
    RAISE EXCEPTION 'Mevzuat kaydında yalnız açık yürürlük bitişi kapatılabilir (MVZ-02)';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER mevzuat_kayit_degismez BEFORE UPDATE ON "mevzuat_kayitlari"
  FOR EACH ROW EXECUTE FUNCTION mevzuat_kayit_degismez();
