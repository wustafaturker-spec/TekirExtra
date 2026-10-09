-- MVZ aşama 2 (2026-10-09): tevkifat kodları Mevzuat Merkezi'ne taşınır.

-- ─── İlk dolum (MVZ-12) ──────────────────────────────────────────────────
-- Kaynak: GİB UBL-TR Kod Listeleri v1.42 (Mart 2026), KDVGUT I/C-2.1.3.
-- Geçmiş dönem ayrımı yapılmadı: değerler 2000-01-01'den yürürlükte sayılır
-- (önceki davranışla aynı — sabit tablo tarihe bakmıyordu). Sonraki her
-- değişiklik platform panelinden, dayanak ve yürürlük tarihiyle yapılır.
INSERT INTO "mevzuat_kayitlari" ("id", "tur", "anahtar", "deger", "yururluk_baslangic") VALUES
  (gen_random_uuid(), 'tevkifat_kodu', '601', '{"ad":"YAPIM İŞLERİ İLE BU İŞLERLE BİRLİKTE İFA EDİLEN MÜHENDİSLİK-MİMARLIK VE ETÜT-PROJE HİZMETLERİ","oranlar":["4/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '602', '{"ad":"ETÜT, PLAN-PROJE, DANIŞMANLIK, DENETİM VE BENZERİ HİZMETLER","oranlar":["9/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '603', '{"ad":"MAKİNE, TEÇHİZAT, DEMİRBAŞ VE TAŞITLARA AİT TADİL, BAKIM VE ONARIM HİZMETLERİ","oranlar":["7/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '604', '{"ad":"YEMEK SERVİS HİZMETİ","oranlar":["5/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '605', '{"ad":"ORGANİZASYON HİZMETİ","oranlar":["5/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '606', '{"ad":"İŞGÜCÜ TEMİN HİZMETLERİ","oranlar":["9/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '607', '{"ad":"ÖZEL GÜVENLİK HİZMETİ","oranlar":["9/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '608', '{"ad":"YAPI DENETİM HİZMETLERİ","oranlar":["9/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '609', '{"ad":"FASON OLARAK YAPTIRILAN TEKSTİL VE KONFEKSİYON İŞLERİ, ÇANTA VE AYAKKABI DİKİM İŞLERİ VE BU İŞLERE ARACILIK HİZMETLERİ","oranlar":["7/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '610', '{"ad":"TURİSTİK MAĞAZALARA VERİLEN MÜŞTERİ BULMA / GÖTÜRME HİZMETLERİ","oranlar":["9/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '611', '{"ad":"SPOR KULÜPLERİNİN YAYIN, REKLÂM VE İSİM HAKKI GELİRLERİNE KONU İŞLEMLERİ","oranlar":["9/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '612', '{"ad":"TEMİZLİK HİZMETİ","oranlar":["9/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '613', '{"ad":"ÇEVRE VE BAHÇE BAKIM HİZMETLERİ","oranlar":["9/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '614', '{"ad":"SERVİS TAŞIMACILIĞI HİZMETİ","oranlar":["5/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '615', '{"ad":"HER TÜRLÜ BASKI VE BASIM HİZMETLERİ","oranlar":["7/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '616', '{"ad":"DİĞER HİZMETLER","oranlar":["5/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '617', '{"ad":"HURDA METALDEN ELDE EDİLEN KÜLÇE TESLİMLERİ","oranlar":["7/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '618', '{"ad":"HURDA METALDEN ELDE EDİLENLER DIŞINDAKİ BAKIR, ÇİNKO, DEMİR-ÇELİK, ALÜMİNYUM VE KURŞUN KÜLÇE TESLİMLERİ","oranlar":["7/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '619', '{"ad":"BAKIR, ÇİNKO VE ALÜMİNYUM ÜRÜNLERİNİN TESLİMİ","oranlar":["7/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '620', '{"ad":"İSTİSNADAN VAZGEÇENLERİN HURDA VE ATIK TESLİMİ","oranlar":["7/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '621', '{"ad":"METAL, PLASTİK, LASTİK, KAUÇUK, KÂĞIT VE CAM HURDA VE ATIKLARDAN ELDE EDİLEN HAMMADDE TESLİMİ","oranlar":["9/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '622', '{"ad":"PAMUK, TİFTİK, YÜN VE YAPAĞI İLE HAM POST VE DERİ TESLİMLERİ","oranlar":["9/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '623', '{"ad":"AĞAÇ VE ORMAN ÜRÜNLERİ TESLİMİ","oranlar":["5/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '624', '{"ad":"YÜK TAŞIMACILIĞI HİZMETİ","oranlar":["2/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '625', '{"ad":"TİCARİ REKLAM HİZMETLERİ","oranlar":["3/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '626', '{"ad":"DİĞER TESLİMLER","oranlar":["2/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '627', '{"ad":"DEMİR-ÇELİK ÜRÜNLERİNİN TESLİMİ","oranlar":["5/10"]}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'tevkifat_kodu', '650', '{"ad":"DİĞERLERİ","oranlar":["2/10","5/10","7/10","9/10"]}'::jsonb, DATE '2000-01-01')
;

INSERT INTO "mevzuat_olaylari" ("id", "olay", "detay")
VALUES (gen_random_uuid(), 'ilk_dolum', '{"tur": "tevkifat_kodu", "kaynak": "UBL-TR Kod Listeleri v1.42 (Mart 2026)", "kayit": 28, "yururlukBaslangic": "2000-01-01"}'::jsonb);

-- ─── Bilinmeyen kod kaydı (MVZ-10) ───────────────────────────────────────
-- Gelen belgede tanınmayan kod/oran açık talep olarak bir kez açılır, sonra
-- görülme sayısı artar. Uygulama rolü kiracı adını ve açıklamaları okuyamaz;
-- yalnız eşleşme için gereken sütunları görür ve sayacı artırır.
CREATE UNIQUE INDEX "mevzuat_talepleri_bilinmeyen_acik_key"
  ON "mevzuat_talepleri" ("tur", "anahtar")
  WHERE "kaynak" = 'bilinmeyen_kod' AND "durum" = 'acik';
GRANT SELECT ("kaynak", "durum", "tur", "anahtar", "gorulme_sayisi") ON "mevzuat_talepleri" TO tekir_app;
GRANT UPDATE ("gorulme_sayisi", "updated_at") ON "mevzuat_talepleri" TO tekir_app;

-- ─── Etki önizlemesi (MVZ-06) ────────────────────────────────────────────
-- Platform rolü kiracı tablolarını okuyamaz; yalnız toplam sayıları veren bu
-- fonksiyonu çalıştırır. Kiracı adı ya da belge bilgisi dönmez. Sahibi şema
-- sahibidir (RLS'i aşan rol); FORCE RLS'li tablolarda sahibi BYPASSRLS
-- değilse row_security=off ayarı sessiz 0 yerine hata verir.
CREATE FUNCTION mevzuat_etki_tevkifat(kodlar text[], yururluk date)
RETURNS TABLE (taslak_fatura bigint, firma bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT count(DISTINCT f.id), count(DISTINCT f.tenant_id)
  FROM faturalar f
  WHERE f.durum = 'taslak' AND f.tarih >= yururluk
    AND EXISTS (SELECT 1 FROM fatura_satirlari s WHERE s.fatura_id = f.id AND s.tevkifat_kodu = ANY(kodlar));
$$;
REVOKE ALL ON FUNCTION mevzuat_etki_tevkifat(text[], date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mevzuat_etki_tevkifat(text[], date) TO tekir_platform;
