-- P1-9: kasa/banka açılış (devir) fişi.
-- Açılış, kaynak_tur = 'acilis' olan bir tahsilat (artı bakiye) ya da tediye
-- (eksi bakiye) fişidir: bakiyeye girer, tahsilat/ödeme sayılmaz, makbuz
-- numarası almaz. Her kasa ve banka hesabında en fazla bir tane olur.

CREATE OR REPLACE FUNCTION makbuz_no_ver() RETURNS trigger AS $$
DECLARE
  fis_yili integer;
  seri_onek text;
  sira integer;
BEGIN
  IF NEW.makbuz_no IS NOT NULL
     OR NEW.tip::text NOT IN ('tahsilat', 'tediye')
     OR NEW.kaynak_tur IN ('ters_kayit', 'cek_senet', 'kredi_karti_ekstre', 'pos_mutabakat', 'personel_maas_iptal', 'acilis') THEN
    RETURN NEW;
  END IF;
  fis_yili := extract(year FROM NEW.tarih)::integer;
  -- Yeni yılın serisi, önceki yılın önekini sürdürür.
  SELECT onek INTO seri_onek FROM makbuz_serileri
   WHERE tenant_id = NEW.tenant_id AND tur = NEW.tip::text
   ORDER BY yil DESC LIMIT 1;
  -- ON CONFLICT satırı kilitler: eşzamanlı iki fiş aynı numarayı alamaz.
  INSERT INTO makbuz_serileri (tenant_id, tur, yil, onek, son_sira)
  VALUES (NEW.tenant_id, NEW.tip::text, fis_yili, COALESCE(seri_onek, CASE WHEN NEW.tip::text = 'tahsilat' THEN 'TM' ELSE 'TD' END), 1)
  ON CONFLICT (tenant_id, tur, yil) DO UPDATE SET son_sira = makbuz_serileri.son_sira + 1
  RETURNING onek, son_sira INTO seri_onek, sira;
  NEW.makbuz_no := seri_onek || fis_yili || '-' || lpad(sira::text, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE UNIQUE INDEX "kasa_banka_hareketleri_acilis_kasa_key"
  ON "kasa_banka_hareketleri" ("tenant_id", "kasa_id")
  WHERE "kaynak_tur" = 'acilis' AND "kasa_id" IS NOT NULL;

CREATE UNIQUE INDEX "kasa_banka_hareketleri_acilis_banka_key"
  ON "kasa_banka_hareketleri" ("tenant_id", "banka_hesap_id")
  WHERE "kaynak_tur" = 'acilis' AND "banka_hesap_id" IS NOT NULL;
