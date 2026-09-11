-- Gerçek kişi carilerde ad ve soyad ayrı tutulur (CARI-21). e-Arşiv UBL'i
-- TCKN'li alıcıda FirstName/FamilyName ister; tek unvan alanından son kelimeyi
-- soyad saymak birden çok soyadı olan kişide yanlış sonuç veriyordu.
ALTER TABLE "cari_hesaplar"
  ADD COLUMN "ad" TEXT,
  ADD COLUMN "soyad" TEXT;

-- Mevcut gerçek kişiler unvandan doldurulur (son kelime soyad, kalanı ad);
-- kullanıcı kartta düzeltebilir. Tek kelimelik unvanda soyad boş kalır.
UPDATE "cari_hesaplar"
SET "ad" = CASE WHEN btrim("unvan") ~ '\s' THEN regexp_replace(btrim("unvan"), '\s+\S+$', '') ELSE btrim("unvan") END,
    "soyad" = CASE WHEN btrim("unvan") ~ '\s' THEN substring(btrim("unvan") from '(\S+)$') ELSE NULL END
WHERE "kisi_tipi" = 'gercek';
