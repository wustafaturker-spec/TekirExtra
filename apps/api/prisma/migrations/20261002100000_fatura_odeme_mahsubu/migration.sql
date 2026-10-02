-- KSB-07: ödemenin fatura dövizindeki karşılığı ve faturaya mahsup edilen kısmı.
-- Faturanın kalanı artık yalnız `fatura_mahsubu` toplamından hesaplanır.
ALTER TABLE "kasa_banka_hareketleri" ADD COLUMN "fatura_karsiligi" DECIMAL(15,2),
ADD COLUMN "fatura_mahsubu" DECIMAL(15,2);

ALTER TABLE "kredi_karti_hareketleri" ADD COLUMN "fatura_mahsubu" DECIMAL(15,2);

-- Mevcut kayıtlar bugünkü hesabı korur: aynı dövizde tutarın kendisi, farklı
-- dövizde TL karşılığı fatura kuruyla çevrilir. Kalanı aşan eski ödemeler
-- olduğu gibi kalır; düzeltme merkezi onları "ödeme toplamı aşımı" olarak gösterir.
UPDATE "kasa_banka_hareketleri" h
SET "fatura_karsiligi" = CASE
      WHEN h."doviz_cinsi" = f."doviz_cinsi" THEN h."tutar"
      ELSE ROUND(h."tutar_try" / NULLIF(f."kur", 0), 2)
    END
FROM "faturalar" f
WHERE h."fatura_id" = f."id";

UPDATE "kasa_banka_hareketleri" SET "fatura_mahsubu" = "fatura_karsiligi" WHERE "fatura_id" IS NOT NULL;

UPDATE "kredi_karti_hareketleri" SET "fatura_mahsubu" = "cari_odeme_tutari" WHERE "fatura_id" IS NOT NULL;
