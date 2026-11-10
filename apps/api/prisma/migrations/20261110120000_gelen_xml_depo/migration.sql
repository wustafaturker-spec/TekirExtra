-- Gelen e-Fatura XML'i nesne deposuna taşınır. Geçişte veritabanı kopyası korunur,
-- yalnız depodaki nesne doğrulandıktan sonra boşaltılır; bu yüzden sütun NULL olabilir.
ALTER TABLE "gelen_ebelgeler" ALTER COLUMN "xml_icerik" DROP NOT NULL;
ALTER TABLE "gelen_ebelgeler" ADD COLUMN "xml_anahtar" VARCHAR(200);
ALTER TABLE "gelen_ebelgeler" ADD COLUMN "xml_ozet" VARCHAR(64);
