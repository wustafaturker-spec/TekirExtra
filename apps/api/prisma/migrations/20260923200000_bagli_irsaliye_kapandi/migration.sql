-- FTR-26: faturaya bağlı irsaliye "kapandı" sayılır. EBLG-76 yolları
-- (irsaliye formunda önceden düzenlenen fatura, e-Fatura sihirbazının sevkiyat
-- adımı) bağı kuruyor ama durumu "onaylı" bırakıyordu; bu kayıtlar toplu
-- faturalama listesinde yeniden seçilebilir görünüyordu.
UPDATE "belgeler"
SET "durum" = 'kapandi'
WHERE "tur" = 'irsaliye'
  AND "durum" = 'onaylandi'
  AND "fatura_id" IS NOT NULL;
