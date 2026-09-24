-- EBLG-87: ithal malın gümrükten depoya kısım kısım taşınması için e-İrsaliye.
ALTER TABLE "belgeler" ADD COLUMN "gumruk_depo_sevki" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "belgeler" ADD COLUMN "gumruk_beyanname_no" TEXT;
ALTER TABLE "belgeler" ADD COLUMN "gumruk_beyanname_tarihi" DATE;
ALTER TABLE "belgeler" ADD COLUMN "gumruk_sefer_no" INTEGER;
ALTER TABLE "belgeler" ADD COLUMN "yukleme_adres" TEXT;
ALTER TABLE "belgeler" ADD COLUMN "yukleme_il" TEXT;
ALTER TABLE "belgeler" ADD COLUMN "yukleme_ilce" TEXT;
ALTER TABLE "belgeler" ADD COLUMN "yukleme_posta_kodu" TEXT;

-- Boşaltma adresi depo kartından gelir; GİB il, ilçe ve posta kodunu ayrı ister.
ALTER TABLE "depolar" ADD COLUMN "il" TEXT;
ALTER TABLE "depolar" ADD COLUMN "ilce" TEXT;
ALTER TABLE "depolar" ADD COLUMN "posta_kodu" TEXT;

-- Firmanın kendine gönderdiği belgenin gelen kopyası yanıt beklemez.
ALTER TABLE "gelen_eirsaliyeler" ADD COLUMN "kendi_sevkimiz" BOOLEAN NOT NULL DEFAULT false;
