-- KSB-15: banka hareketlerinin worker'da otomatik çekimi.
ALTER TABLE "baglantilar"
  ADD COLUMN "otomatik_senkron_dk" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "son_senkron_denemesi" TIMESTAMP(3),
  ADD COLUMN "ardisik_hata" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "otomatik_durdu_nedeni" TEXT;
