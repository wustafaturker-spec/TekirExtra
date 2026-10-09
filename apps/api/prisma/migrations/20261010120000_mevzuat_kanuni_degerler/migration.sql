-- MVZ aşama 4 (2026-10-09): kanuni süre ve eşikler kiracı ayarından Mevzuat Merkezi'ne taşınır.
-- Değerler önceki sistem varsayılanlarıdır; geçmiş dönem ayrımı yapılmadı.
-- • babs_esigi 5.000 TL: Form BA/BS, VUK Genel Tebliği (Sıra No 396) — aynı kişiyle
--   aylık KDV hariç toplam bu tutar ve üzerindeyse bildirilir.
-- • irsaliye_fatura_gun 7: VUK 231/5 — fatura malın teslimi tarihinden itibaren 7 gün içinde.
-- • earsiv_iptal_gun 8: önceki sistem varsayılanı (sektör uygulaması, TTK 21/2'deki 8 günlük
--   itiraz süresine dayanır); tebliğ metniyle doğrulanmadı — platform ekibi dayanağı teyit etmeli.
-- • tevkifat_alt_siniri yüklenmedi: doğrulanmış dayanağı olmadan girilmez.
INSERT INTO "mevzuat_kayitlari" ("id", "tur", "anahtar", "deger", "yururluk_baslangic") VALUES
  (gen_random_uuid(), 'kanuni_deger', 'babs_esigi', '{"deger": 5000}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'kanuni_deger', 'irsaliye_fatura_gun', '{"deger": 7}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'kanuni_deger', 'earsiv_iptal_gun', '{"deger": 8}'::jsonb, DATE '2000-01-01');

INSERT INTO "mevzuat_olaylari" ("id", "olay", "detay") VALUES
  (gen_random_uuid(), 'ilk_dolum', '{"tur": "kanuni_deger", "kaynak": "Önceki sistem varsayılanları (BA/BS 5.000 TL VUK GT 396; irsaliye 7 gün VUK 231/5; e-Arşiv iptal 8 gün sektör uygulaması — doğrulanmalı)", "yururlukBaslangic": "2000-01-01"}'::jsonb);
