-- EBLG-96: gelen e-İrsaliyeye yanıt süresi fiilî sevk tarihinden sayılır (GİB SSS 57).
ALTER TABLE "gelen_eirsaliyeler" ADD COLUMN "sevk_tarihi" DATE;

-- Mevcut kayıtlar XML'deki ActualDespatchDate'ten doldurulur; okunamazsa belge tarihi.
UPDATE "gelen_eirsaliyeler"
SET "sevk_tarihi" = COALESCE(
  (substring("xml_icerik" from '<(?:[A-Za-z0-9]+:)?ActualDespatchDate>\s*([0-9]{4}-[0-9]{2}-[0-9]{2})'))::date,
  "tarih"
);

ALTER TABLE "gelen_eirsaliyeler" ALTER COLUMN "sevk_tarihi" SET NOT NULL;
