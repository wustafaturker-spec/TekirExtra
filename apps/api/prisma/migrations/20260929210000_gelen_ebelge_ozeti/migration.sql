-- Gelen e-belge listesinin özeti (satır sayısı, toplam, döviz) belge
-- kaydedilirken yazılır; liste XML'e dokunmaz. Liste her çağrıda bütün
-- XML'leri (demo kiracıda 1848 belge, 490 MB) ayrıştırıp API'yi bellek
-- yetersizliğinden düşürüyordu (2026-09-29).
ALTER TABLE "gelen_ebelgeler"
  ADD COLUMN "satir_sayisi" INTEGER,
  ADD COLUMN "genel_toplam" DECIMAL(18,2),
  ADD COLUMN "doviz_cinsi" TEXT,
  ADD COLUMN "okunabilir" BOOLEAN;

-- Mevcut kayıtlar XML'den doldurulur. Uygulamadaki okuyucunun kuralıyla
-- aynı: toplam PayableAmount, yoksa TaxInclusiveAmount. Doldurulamayanlar
-- NULL kalır; liste onları ilk açılışta uygulamanın okuyucusuyla tamamlar.
UPDATE "gelen_ebelgeler" SET
  "okunabilir" = "xml_icerik" ~ '<([A-Za-z0-9]+:)?Invoice[[:space:]>]',
  "doviz_cinsi" = COALESCE((regexp_match("xml_icerik", '<(?:[A-Za-z0-9]+:)?DocumentCurrencyCode[^>]*>[[:space:]]*([A-Za-z]{3})'))[1], 'TRY'),
  "genel_toplam" = COALESCE(
    (regexp_match("xml_icerik", '<(?:[A-Za-z0-9]+:)?PayableAmount[^>]*>[[:space:]]*(-?[0-9]+(?:\.[0-9]+)?)'))[1],
    (regexp_match("xml_icerik", '<(?:[A-Za-z0-9]+:)?TaxInclusiveAmount[^>]*>[[:space:]]*(-?[0-9]+(?:\.[0-9]+)?)'))[1]
  )::DECIMAL(18,2),
  "satir_sayisi" = (SELECT count(*) FROM regexp_matches("xml_icerik", '<(?:[A-Za-z0-9]+:)?InvoiceLine[[:space:]>]', 'g'));

UPDATE "gelen_ebelgeler" SET "genel_toplam" = NULL, "satir_sayisi" = NULL, "doviz_cinsi" = NULL, "okunabilir" = NULL
WHERE "okunabilir" AND ("genel_toplam" IS NULL OR "satir_sayisi" = 0);
