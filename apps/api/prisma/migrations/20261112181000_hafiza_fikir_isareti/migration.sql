-- CNL-11: fikir işareti ajan hafızasına yazılır (tür ve etiket kısıtları genişler).
ALTER TABLE "ai_hafiza" DROP CONSTRAINT "ai_hafiza_tur_check";
ALTER TABLE "ai_hafiza" ADD CONSTRAINT "ai_hafiza_tur_check" CHECK ("tur" IN ('urun_eslesme', 'cari_eslesme', 'musteri_tercihi', 'siniflandirma', 'susturma', 'fikir_isareti'));
ALTER TABLE "ai_hafiza" DROP CONSTRAINT "ai_hafiza_etiket_check";
ALTER TABLE "ai_hafiza" ADD CONSTRAINT "ai_hafiza_etiket_check" CHECK ("etiket" IS NULL OR "etiket" IN ('teklif', 'teklif_degil', 'yarar', 'yaramaz', 'getirme'));
ALTER TABLE "ai_hafiza" ADD CONSTRAINT "ai_hafiza_fikir_isareti_check" CHECK ("tur" <> 'fikir_isareti' OR "etiket" IN ('yarar', 'yaramaz', 'getirme'));
