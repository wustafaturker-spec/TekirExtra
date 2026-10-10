-- EBLG-120: KDV dışı vergiler (ÖTV, ÖİV, konaklama, BSMV, stopaj…) faturada.
-- AlterTable
ALTER TABLE "faturalar" ADD COLUMN     "toplam_ek_vergi" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "toplam_stopaj" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "fatura_satirlari" ADD COLUMN     "ek_vergi_tutari" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ek_vergiler" JSONB,
ADD COLUMN     "stopaj_tutari" DECIMAL(15,2) NOT NULL DEFAULT 0;


-- ─── Vergi türleri ilk dolumu (Mevzuat Merkezi) ─────────────────────────
-- Kaynak: UBL-TR vergi türü kodları; davranış ve KDV matrahı kuralı
-- 2026-10-10'da gelen 36 belgede doğrulandı (ÖTV, elektrik tüketim, KKDF
-- dahil; ÖİV, konaklama, BSMV, borsa tescil hariç). Sonraki her değişiklik
-- platform panelinden, dayanak ve yürürlük tarihiyle yapılır.
INSERT INTO "mevzuat_kayitlari" ("id", "tur", "anahtar", "deger", "yururluk_baslangic") VALUES
  (gen_random_uuid(), 'vergi_turu_kodu', '0003', '{"ad":"Gelir Vergisi Stopajı","davranis":"stopaj","kdvMatrahi":"haric"}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'vergi_turu_kodu', '0011', '{"ad":"Kurumlar Vergisi Stopajı","davranis":"stopaj","kdvMatrahi":"haric"}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'vergi_turu_kodu', '0021', '{"ad":"Banka Muameleleri Vergisi","davranis":"maliyet","kdvMatrahi":"haric"}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'vergi_turu_kodu', '0022', '{"ad":"Sigorta Muameleleri Vergisi","davranis":"maliyet","kdvMatrahi":"haric"}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'vergi_turu_kodu', '0059', '{"ad":"Konaklama Vergisi","davranis":"maliyet","kdvMatrahi":"haric"}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'vergi_turu_kodu', '0061', '{"ad":"Kaynak Kullanımını Destekleme Fonu Kesintisi","davranis":"maliyet","kdvMatrahi":"dahil"}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'vergi_turu_kodu', '0071', '{"ad":"ÖTV I. Liste (petrol ve doğalgaz ürünleri)","davranis":"maliyet","kdvMatrahi":"dahil"}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'vergi_turu_kodu', '0073', '{"ad":"ÖTV III. Liste (kolalı gazoz, alkollü içki, tütün)","davranis":"maliyet","kdvMatrahi":"dahil"}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'vergi_turu_kodu', '0074', '{"ad":"ÖTV IV. Liste (dayanıklı tüketim ve diğer mallar)","davranis":"maliyet","kdvMatrahi":"dahil"}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'vergi_turu_kodu', '4080', '{"ad":"Özel İletişim Vergisi","davranis":"maliyet","kdvMatrahi":"haric"}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'vergi_turu_kodu', '8001', '{"ad":"Borsa Tescil Ücreti","davranis":"maliyet","kdvMatrahi":"haric"}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'vergi_turu_kodu', '8005', '{"ad":"Elektrik Tüketim Vergisi","davranis":"maliyet","kdvMatrahi":"dahil"}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'vergi_turu_kodu', '9021', '{"ad":"4961 Banka Sigorta Muameleleri Vergisi","davranis":"maliyet","kdvMatrahi":"haric"}'::jsonb, DATE '2000-01-01'),
  (gen_random_uuid(), 'vergi_turu_kodu', '9077', '{"ad":"ÖTV II. Liste (motorlu taşıtlar)","davranis":"maliyet","kdvMatrahi":"dahil"}'::jsonb, DATE '2000-01-01');

INSERT INTO "mevzuat_olaylari" ("id", "olay", "detay")
VALUES (gen_random_uuid(), 'ilk_dolum', '{"tur": "vergi_turu_kodu", "kaynak": "UBL-TR vergi türü kodları; KDV matrahı kuralı gelen belgelerde doğrulandı (EBLG-120)", "kayit": 14, "yururlukBaslangic": "2000-01-01"}'::jsonb);

-- Etki önizlemesi: vergi türü değişikliği, o kodu taşıyan taslak faturaları sayar.
CREATE OR REPLACE FUNCTION mevzuat_etki(p_tur text, p_anahtarlar text[], p_yururluk date)
RETURNS TABLE (taslak_fatura bigint, taslak_belge bigint, firma bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  WITH f AS (
    SELECT f.id, f.tenant_id FROM faturalar f
    WHERE f.durum = 'taslak' AND f.tarih >= p_yururluk AND (
      (p_tur = 'tevkifat_kodu' AND EXISTS (SELECT 1 FROM fatura_satirlari s WHERE s.fatura_id = f.id AND s.tevkifat_kodu = ANY(p_anahtarlar)))
      OR (p_tur = 'kdv_orani' AND EXISTS (SELECT 1 FROM fatura_satirlari s WHERE s.fatura_id = f.id AND s.kdv_orani::text::numeric = ANY(p_anahtarlar::numeric[])))
      OR (p_tur = 'kdv_istisna_kodu' AND EXISTS (SELECT 1 FROM fatura_satirlari s WHERE s.fatura_id = f.id AND s.gib_istisna_kodu = ANY(p_anahtarlar)))
      OR (p_tur = 'ozel_matrah_kodu' AND f.ozel_matrah_kodu = ANY(p_anahtarlar))
      OR (p_tur = 'ihrac_kayitli_kodu' AND f.ihrac_kayitli_kodu = ANY(p_anahtarlar))
      OR (p_tur = 'vergi_turu_kodu' AND EXISTS (SELECT 1 FROM fatura_satirlari s, jsonb_array_elements(COALESCE(s.ek_vergiler, '[]'::jsonb)) v WHERE s.fatura_id = f.id AND v->>'kod' = ANY(p_anahtarlar)))
    )
  ), b AS (
    SELECT b.id, b.tenant_id FROM belgeler b
    WHERE p_tur = 'kdv_orani' AND b.durum = 'taslak' AND b.tarih >= p_yururluk
      AND EXISTS (SELECT 1 FROM belge_satirlari s WHERE s.belge_id = b.id AND s.kdv_orani::text::numeric = ANY(p_anahtarlar::numeric[]))
  )
  SELECT (SELECT count(*) FROM f), (SELECT count(*) FROM b),
         (SELECT count(DISTINCT t) FROM (SELECT tenant_id t FROM f UNION SELECT tenant_id FROM b) x);
$$;
