-- Daha önce oluşturulan kredi kartı cari ödemelerinde ödeme aracını açıklamaya ekle.
-- Yapılandırılmış kaynak bağlantısı korunur; bu metin ekstre/PDF/Excel gibi düz
-- açıklama kullanan bütün çıktılarda ödeme yönteminin görünmesini sağlar.
UPDATE "cari_hareketler" AS ch
SET "aciklama" = CONCAT(
  COALESCE(NULLIF(ch."aciklama", ''), 'Cari hesap ödemesi'),
  ' · Kredi kartı: ', kk."ad", ' •••• ', kk."son_dort_hane",
  CASE WHEN kkh."taksit_sayisi" > 1
    THEN CONCAT(' · ', kkh."taksit_sayisi", ' taksit')
    ELSE ' · tek çekim'
  END,
  CASE WHEN kkh."komisyon_tutari" > 0
    THEN CONCAT(' · ', kkh."komisyon_tutari", ' ', kk."doviz_cinsi", ' komisyon/vade farkı')
    ELSE ''
  END
)
FROM "kredi_karti_hareketleri" AS kkh
JOIN "kredi_kartlari" AS kk ON kk."id" = kkh."kredi_karti_id"
WHERE ch."kaynak_tur" = 'kredi_karti'
  AND ch."kaynak_ref" = kkh."id"::text
  AND COALESCE(ch."aciklama", '') NOT LIKE '%Kredi kartı:%';
