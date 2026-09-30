-- Yan/ortak ürün maliyet yöntemi (reçete sürümü başına).
CREATE TYPE "YanUrunMaliyetYontemi" AS ENUM ('sifir', 'sabit_deger', 'satis_degeri');

ALTER TABLE "urun_receteleri"
  ADD COLUMN "olusturan_user_id" UUID,
  ADD COLUMN "yan_urun_maliyet_yontemi" "YanUrunMaliyetYontemi" NOT NULL DEFAULT 'sifir';

ALTER TABLE "urun_recetesi_ciktilari" ADD COLUMN "birim_maliyet" DECIMAL(15,4);

ALTER TABLE "uretim_emirleri" ADD COLUMN "planlanan_bitis" DATE;

ALTER TABLE "uretim_bildirimleri"
  ADD COLUMN "operasyon_maliyeti" DECIMAL(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN "mamul_birim_maliyeti" DECIMAL(15,4);
