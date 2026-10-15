-- Geri alınan ödeme, taksidi açık hâle getirmelidir. Eski veritabanlarında
-- islem_id FK'si bulunmadığından önce yalnız sahipsiz işlem referanslarını boşalt.
UPDATE "banka_kredi_taksitleri" t
SET "islem_id" = NULL
WHERE t."islem_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "banka_kredi_islemleri" i WHERE i."id" = t."islem_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'banka_kredi_taksitleri_kredi_id_fkey') THEN
    ALTER TABLE "banka_kredi_taksitleri"
      ADD CONSTRAINT "banka_kredi_taksitleri_kredi_id_fkey"
      FOREIGN KEY ("kredi_id") REFERENCES "banka_kredileri"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'banka_kredi_taksitleri_islem_id_fkey') THEN
    ALTER TABLE "banka_kredi_taksitleri"
      ADD CONSTRAINT "banka_kredi_taksitleri_islem_id_fkey"
      FOREIGN KEY ("islem_id") REFERENCES "banka_kredi_islemleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
