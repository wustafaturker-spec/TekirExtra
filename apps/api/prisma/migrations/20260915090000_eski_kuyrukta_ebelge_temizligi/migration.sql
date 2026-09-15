-- Eski kesinleştirme akışından kalan e-Belge kayıtları (EBLG-37).
--
-- 2026-08-23'e (6a2d613) kadar fatura kesinleştirilince e-Belge kaydı
-- otomatik `kuyrukta` açılıyordu; gönderim hiç başlamadığı için bu kayıtlar
-- takılı kaldı ve faturanın sihirbazdan gönderilmesini engelliyor. Yalnız
-- hiç dokunulmamış, referanssız ve arşivsiz olanlar silinir: fatura "e-belgesi
-- yok" durumuna döner. Başlangıç satırları durum geçmişinde kalır (EBLG-35,
-- geçmiş yalnız eklenir).
DELETE FROM "ebelge_kayitlari" e
WHERE e."durum" = 'kuyrukta'
  AND e."entegrator_ref" IS NULL
  AND e."created_at" < '2026-08-23'
  AND e."updated_at" = e."created_at"
  AND NOT EXISTS (SELECT 1 FROM "ebelge_arsiv" a WHERE a."ebelge_id" = e."id");
