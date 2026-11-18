-- END-10: taslak açıldıktan sonra birim katsayısı değişmiş olabilir.
-- Stok etkisinin doğduğu kesinleşme anındaki katsayı saklanır.
CREATE FUNCTION fatura_birimlerini_sabitle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.durum = 'kesin' AND OLD.durum IS DISTINCT FROM NEW.durum THEN
   UPDATE fatura_satirlari fs SET birim_katsayi = (
     SELECT CASE WHEN fs.birim = s.ana_birim THEN 1::numeric ELSE
       (SELECT b.katsayi FROM stok_birimleri b WHERE b.stok_id = s.id AND b.tenant_id = NEW.tenant_id AND b.ad = fs.birim LIMIT 1)
     END FROM stok_kartlari s WHERE s.id = fs.stok_id AND s.tenant_id = NEW.tenant_id
   ) WHERE fs.fatura_id = NEW.id AND fs.tenant_id = NEW.tenant_id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER fatura_birimlerini_sabitle AFTER UPDATE OF durum ON faturalar
 FOR EACH ROW EXECUTE FUNCTION fatura_birimlerini_sabitle();
