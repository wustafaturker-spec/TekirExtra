-- END-10: kullanılmamış stok kartı, ek birimleriyle birlikte silinebilir.
CREATE OR REPLACE FUNCTION stok_birim_tarihcesi_yaz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME = 'stok_kartlari' THEN
   IF NEW.ana_birim IS DISTINCT FROM OLD.ana_birim THEN
     INSERT INTO stok_birim_gecmisi (tenant_id, stok_id, birim, eski_birim, yeni_birim, eski_katsayi, yeni_katsayi)
     VALUES (NEW.tenant_id, NEW.id, NEW.ana_birim, OLD.ana_birim, NEW.ana_birim, 1, 1);
   END IF;
 ELSIF TG_OP = 'DELETE' THEN
   -- Stok kartının CASCADE silinmesi tarihçe kaydı üretmemeli.
   IF NOT EXISTS (SELECT 1 FROM stok_kartlari WHERE id = OLD.stok_id) THEN RETURN NULL; END IF;
   INSERT INTO stok_birim_gecmisi (tenant_id, stok_id, birim, eski_birim, eski_katsayi)
   VALUES (OLD.tenant_id, OLD.stok_id, OLD.ad, OLD.ad, OLD.katsayi);
 ELSIF TG_OP = 'UPDATE' AND (NEW.ad, NEW.katsayi) IS DISTINCT FROM (OLD.ad, OLD.katsayi) THEN
   INSERT INTO stok_birim_gecmisi (tenant_id, stok_id, birim, eski_birim, yeni_birim, eski_katsayi, yeni_katsayi)
   VALUES (NEW.tenant_id, NEW.stok_id, NEW.ad, OLD.ad, NEW.ad, OLD.katsayi, NEW.katsayi);
 END IF;
 RETURN NULL;
END $$;
