-- MVZ (2026-10-09): kıdem tazminatı tavanı koddan (cikis-hesabi.ts KIDEM_TAVANLARI)
-- Mevzuat Merkezi'ne taşınır (`kanuni_deger / kidem_tavani`).
-- Kaynak: Hazine ve Maliye Bakanlığı kıdem tazminatı tavanı genelgeleri (2026-10-04 doğrulandı):
-- 01.01.2026–30.06.2026: 64.948,77 TL · 01.07.2026'dan: 73.729,87 TL.
-- Tavan Ocak ve Temmuz'da değişir; uygulama bir kaydı yalnız başladığı yarıyılda
-- kullanır, 2027/1 tavanı platform panelinden yayınlanmalıdır.
INSERT INTO "mevzuat_kayitlari" ("id", "tur", "anahtar", "deger", "yururluk_baslangic", "yururluk_bitis") VALUES
  (gen_random_uuid(), 'kanuni_deger', 'kidem_tavani', '{"deger": 64948.77}'::jsonb, DATE '2026-01-01', DATE '2026-06-30'),
  (gen_random_uuid(), 'kanuni_deger', 'kidem_tavani', '{"deger": 73729.87}'::jsonb, DATE '2026-07-01', NULL);

INSERT INTO "mevzuat_olaylari" ("id", "olay", "detay") VALUES
  (gen_random_uuid(), 'ilk_dolum', '{"tur": "kanuni_deger", "anahtar": "kidem_tavani", "kaynak": "HMB kıdem tazminatı tavanı 2026/1 64.948,77 TL, 2026/2 73.729,87 TL", "kayit": 2, "yururlukBaslangic": "2026-01-01"}'::jsonb);
