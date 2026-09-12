-- Masraf kaydı döviz cinsini tutuyordu ama kurunu tutmuyordu; masraftan doğan
-- kasa/banka ve cari hareketler bu yüzden kur 1 ile, yani döviz tutarını TL
-- sanarak yazılıyordu. Kur artık belgenin kendisinde durur (GelirKaydi ile aynı
-- desen) ve tahakkuk hesabı da onu kullanır.
ALTER TABLE "masraflar" ADD COLUMN "kur" DECIMAL(15, 6) NOT NULL DEFAULT 1;

-- Mevcut dövizli masrafların kuru, belge tarihindeki (yoksa en yakın önceki)
-- TCMB döviz satış kurundan doldurulur: gider yabancı para alınarak ödenir.
-- Kur kaydı olmayanlar 1 kalır; rapor bunları "kuru bilinmiyor" diye ayırır.
UPDATE "masraflar" m
SET "kur" = COALESCE((
  SELECT dk."doviz_satis"
  FROM "doviz_kurlari" dk
  WHERE dk."tenant_id" = m."tenant_id"
    AND dk."doviz_cinsi" = m."doviz_cinsi"
    AND dk."tarih" <= m."tarih"
  ORDER BY dk."tarih" DESC
  LIMIT 1
), 1)
WHERE m."doviz_cinsi" <> 'TRY';

-- Yazılmış hareketlerin TL tutarları da düzeltilir; kuru bulunamayan masrafın
-- hareketi (kur = 1) olduğu gibi kalır.
UPDATE "kasa_banka_hareketleri" h
SET "kur" = m."kur", "tutar_try" = ROUND(h."tutar" * m."kur", 2)
FROM "masraflar" m
WHERE h."kaynak_tur" = 'masraf'
  AND h."kaynak_ref" = m."id"::text
  AND m."doviz_cinsi" <> 'TRY'
  AND m."kur" <> 1;

UPDATE "cari_hareketler" h
SET "kur" = m."kur", "tutar_try" = ROUND(h."tutar" * m."kur", 2)
FROM "masraflar" m
WHERE h."kaynak_tur" = 'masraf'
  AND h."kaynak_ref" = m."id"::text
  AND m."doviz_cinsi" <> 'TRY'
  AND m."kur" <> 1;
