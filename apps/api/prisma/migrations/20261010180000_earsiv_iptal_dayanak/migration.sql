-- MVZ (2026-10-09): e-Arşiv iptal süresinin (kanuni_deger/earsiv_iptal_gun = 8) dayanak notu.
-- Değer değişmedi; kayıt değiştirilemez olduğundan not denetim izine eklenir.
-- Dayanak: TTK 21/2 — faturayı alan kişi aldığı tarihten itibaren 8 gün içinde
-- içeriğine itiraz etmezse kabul etmiş sayılır; e-Arşiv iptalinde sektör uygulaması
-- bu süreyi takvim günüyle uygular (ör. BizimHesap "e-Arşiv fatura nasıl iptal edilir").
-- Başlangıç (karar 2026-10-09): fatura tarihi ile gönderim gününden sonraki.
-- Tebliğ metniyle doğrulanmadı; mali müşavir teyidi açık.
INSERT INTO "mevzuat_olaylari" ("id", "olay", "detay") VALUES
  (gen_random_uuid(), 'dayanak_notu', '{"tur": "kanuni_deger", "anahtar": "earsiv_iptal_gun", "dayanak": "TTK 21/2 (faturayı alanın 8 günlük itiraz süresi) + sektör uygulaması; takvim günü", "baslangic": "fatura tarihi ile gönderim gününden sonraki", "dogrulama": "tebliğ metniyle doğrulanmadı; mali müşavir teyidi açık"}'::jsonb);
