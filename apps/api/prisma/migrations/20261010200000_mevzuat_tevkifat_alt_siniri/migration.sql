-- MVZ-12 (2026-10-09): KDV tevkifatı alt sınırı (kanuni_deger/tevkifat_alt_siniri).
-- KDVGUT I/C-2.1.3.1: kısmi tevkifata konu işlemin KDV dahil bedeli, işlemin yapıldığı
-- yıla ilişkin VUK 232 fatura düzenleme sınırını aşmıyorsa tevkifat uygulanmaz
-- (50 Seri No'lu KDV GUT Değişiklik Tebliği, RG 10.02.2024/32456; "2.000 TL" ibaresi
-- yerine fatura düzenleme sınırı, 01.03.2024'ten itibaren). Sınır yıllıktır; uygulama
-- bir kaydı yalnız başladığı yılda kullanır.
-- • 01.03.2024–31.12.2024: 6.900 TL (2024 fatura düzenleme sınırı)
-- • 2025: 9.900 TL (577 Sıra No'lu VUK GT, RG 30.12.2024/32768 2. Mük.)
-- • 2026: 12.000 TL (588 Sıra No'lu VUK GT, RG 31.12.2025/33124 5. Mük.; TÜRMOB sirküleri)
-- 01.03.2024 öncesi (2.000 TL dönemi) yüklenmedi.
INSERT INTO "mevzuat_kayitlari" ("id", "tur", "anahtar", "deger", "yururluk_baslangic", "yururluk_bitis") VALUES
  (gen_random_uuid(), 'kanuni_deger', 'tevkifat_alt_siniri', '{"deger": 6900}'::jsonb, DATE '2024-03-01', DATE '2024-12-31'),
  (gen_random_uuid(), 'kanuni_deger', 'tevkifat_alt_siniri', '{"deger": 9900}'::jsonb, DATE '2025-01-01', DATE '2025-12-31'),
  (gen_random_uuid(), 'kanuni_deger', 'tevkifat_alt_siniri', '{"deger": 12000}'::jsonb, DATE '2026-01-01', NULL);

INSERT INTO "mevzuat_olaylari" ("id", "olay", "detay") VALUES
  (gen_random_uuid(), 'ilk_dolum', '{"tur": "kanuni_deger", "anahtar": "tevkifat_alt_siniri", "kaynak": "KDVGUT I/C-2.1.3.1 (50 Seri No, RG 10.02.2024/32456) + VUK 232 fatura düzenleme sınırı: 2024 6.900 (01.03.2024+), 2025 9.900 (VUK GT 577), 2026 12.000 (VUK GT 588, RG 31.12.2025/33124)", "kayit": 3, "yururlukBaslangic": "2024-03-01"}'::jsonb);
