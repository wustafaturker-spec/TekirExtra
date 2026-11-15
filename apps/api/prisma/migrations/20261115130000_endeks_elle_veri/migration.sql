-- END-05: platform yöneticisi EVDS erişilemezken bir dönemin değerini dayanağıyla elle girer.
-- END-04/05: revizyon ve elle–EVDS farkı platform ekranında "görülmedi" uyarısı olarak durur.
-- Yalnız ekleyicidir.
ALTER TABLE "endeks_degerleri" ADD COLUMN "aciklama" VARCHAR(300);
ALTER TABLE "endeks_deger_revizyonlari" ADD COLUMN "goruldu_at" TIMESTAMP(3);
CREATE INDEX "endeks_deger_revizyonlari_gorulmedi_idx" ON "endeks_deger_revizyonlari" ("seri_kodu") WHERE "goruldu_at" IS NULL;
