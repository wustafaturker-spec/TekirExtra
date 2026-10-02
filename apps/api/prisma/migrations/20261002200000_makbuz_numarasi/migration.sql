-- KSB-09: tahsilat/tediye makbuz numarası.
--
-- Kasa, banka ve POS tahsilat/tediye fişleri kayıt anında seri-sıra numarası
-- alır (varsayılan TM2026-000001 / TD2026-000001; sıra fiş tarihinin yılına
-- göre 1'den başlar). Numara tetikleyiciyle verilir: fiş bugün 18 ayrı yerde
-- oluşturuluyor ve servis katmanında bir yolun numarayı atlaması mümkündü.
-- Virman, ters kayıt ve çek/kart/POS aktarımı kaynaklı iç fişler numara almaz.
-- Geri alınan fişin numarası yanar: sayaç hiçbir zaman geri sarılmaz.

CREATE TABLE "makbuz_serileri" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "tur" TEXT NOT NULL,
    "yil" INTEGER NOT NULL,
    "onek" TEXT NOT NULL,
    "son_sira" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "makbuz_serileri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "makbuz_serileri_tur_check" CHECK ("tur" IN ('tahsilat', 'tediye')),
    CONSTRAINT "makbuz_serileri_onek_check" CHECK ("onek" ~ '^[A-Z]{1,5}$'),
    CONSTRAINT "makbuz_serileri_son_sira_check" CHECK ("son_sira" >= 0)
);

CREATE UNIQUE INDEX "makbuz_serileri_tenant_id_tur_yil_key" ON "makbuz_serileri"("tenant_id", "tur", "yil");
ALTER TABLE "makbuz_serileri" ADD CONSTRAINT "makbuz_serileri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "makbuz_serileri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "makbuz_serileri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "makbuz_serileri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "kasa_banka_hareketleri" ADD COLUMN "makbuz_no" TEXT;
CREATE UNIQUE INDEX "kasa_banka_hareketleri_tenant_id_makbuz_no_key" ON "kasa_banka_hareketleri"("tenant_id", "makbuz_no");

CREATE FUNCTION makbuz_no_ver() RETURNS trigger AS $$
DECLARE
  fis_yili integer;
  seri_onek text;
  sira integer;
BEGIN
  IF NEW.makbuz_no IS NOT NULL
     OR NEW.tip::text NOT IN ('tahsilat', 'tediye')
     OR NEW.kaynak_tur IN ('ters_kayit', 'cek_senet', 'kredi_karti_ekstre', 'pos_mutabakat', 'personel_maas_iptal') THEN
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

CREATE TRIGGER "kasa_banka_hareketleri_makbuz_no" BEFORE INSERT ON "kasa_banka_hareketleri" FOR EACH ROW EXECUTE FUNCTION makbuz_no_ver();

-- Mevcut fişler: tarih + kayıt sırasıyla, yıl bazında numaralanır.
WITH sirali AS (
  SELECT id, tenant_id, tip::text AS tur, extract(year FROM tarih)::integer AS yil,
         row_number() OVER (PARTITION BY tenant_id, tip, extract(year FROM tarih) ORDER BY tarih, created_at, id) AS sira
    FROM kasa_banka_hareketleri
   WHERE tip::text IN ('tahsilat', 'tediye')
     AND kaynak_tur NOT IN ('ters_kayit', 'cek_senet', 'kredi_karti_ekstre', 'pos_mutabakat', 'personel_maas_iptal')
)
UPDATE kasa_banka_hareketleri h
   SET makbuz_no = CASE WHEN s.tur = 'tahsilat' THEN 'TM' ELSE 'TD' END || s.yil || '-' || lpad(s.sira::text, 6, '0')
  FROM sirali s
 WHERE h.id = s.id;

INSERT INTO makbuz_serileri (tenant_id, tur, yil, onek, son_sira)
SELECT tenant_id, tip::text, extract(year FROM tarih)::integer, CASE WHEN tip::text = 'tahsilat' THEN 'TM' ELSE 'TD' END, count(*)
  FROM kasa_banka_hareketleri
 WHERE makbuz_no IS NOT NULL
 GROUP BY tenant_id, tip, extract(year FROM tarih);
