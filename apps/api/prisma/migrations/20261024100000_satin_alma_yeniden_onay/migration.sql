-- SAT-09: onaydan sonra seçilen teklif onaylanan tutarı %10'dan fazla aşarsa
-- ya da onay eşiğinin üstüne çıkarsa talep yeniden onaya düşer.

-- Onay anındaki etkin tutar (TL, KDV hariç). Eski onaylı talepler için
-- tahmini toplam kullanılır: o tarihte teklif girilemediğinden onay bu tutarla verilmişti.
ALTER TABLE satin_alma_talepleri ADD COLUMN onaylanan_tutar DECIMAL(15,2);
UPDATE satin_alma_talepleri SET onaylanan_tutar = tahmini_toplam
  WHERE onay_zamani IS NOT NULL AND durum IN ('onaylandi', 'siparise_donustu');

ALTER TYPE "SatinAlmaOlayTuru" ADD VALUE IF NOT EXISTS 'yeniden_onaya_gonderildi';
