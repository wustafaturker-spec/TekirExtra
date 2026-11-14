-- END-02 genişletmesi (kullanıcı kararı 2026-11-14): döviz kurlarının aylık ortalaması
-- EVDS'den hazır çekilir. Günlük kur tablosu (tcmb_kurlari) 2026-01-02'den başladığı için
-- geçmiş dönem karşılaştırması yapılamıyordu; eksik gün de ortalamayı kaydırıyordu.
-- Yalnız ekleyicidir.
ALTER TABLE "endeks_serileri" ADD COLUMN "kaynak_siklik" VARCHAR(10) NOT NULL DEFAULT 'aylik';
ALTER TABLE "endeks_serileri" ADD COLUMN "tur" VARCHAR(10) NOT NULL DEFAULT 'endeks';
ALTER TABLE "endeks_serileri" ADD CONSTRAINT "endeks_serileri_kaynak_siklik_gecerli" CHECK ("kaynak_siklik" IN ('aylik', 'gunluk'));
ALTER TABLE "endeks_serileri" ADD CONSTRAINT "endeks_serileri_tur_gecerli" CHECK ("tur" IN ('endeks', 'kur'));

-- Gösterge kurları (EVDS grubu bie_dkdovytl), döviz alış; 2026-11-14'te aylık ortalamayla doğrulandı.
INSERT INTO "endeks_serileri" ("kod", "evds_kodu", "ad", "baz_yili", "kaynak", "sira", "kaynak_siklik", "tur", "updated_at") VALUES
  ('USD', 'TP.DK.USD.A.YTL', 'ABD doları (TCMB döviz alış, aylık ortalama)', NULL, 'TCMB', 30, 'gunluk', 'kur', CURRENT_TIMESTAMP),
  ('EUR', 'TP.DK.EUR.A.YTL', 'Euro (TCMB döviz alış, aylık ortalama)', NULL, 'TCMB', 40, 'gunluk', 'kur', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
