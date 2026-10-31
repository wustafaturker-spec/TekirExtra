-- PLT-28: mevzuat değişikliğinde sürüm denetimi. Yalnız ekleme yapar; mevcut kayıtlar 1'den başlar.
-- ADD COLUMN tetikleyici çalıştırmaz; yayınlanmış kayıtların değişmezliği (mevzuat_yayinlanan_degismez) sürer.
ALTER TABLE "mevzuat_degisiklikleri" ADD COLUMN "surum" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "mevzuat_degisiklikleri" ADD CONSTRAINT "mevzuat_degisiklikleri_surum_pozitif" CHECK ("surum" > 0);
