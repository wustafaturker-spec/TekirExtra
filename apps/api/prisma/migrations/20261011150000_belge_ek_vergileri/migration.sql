-- EBLG-132: teklif, sipariş ve irsaliyede KDV dışı vergiler.
-- Mevcut satırlarda ek_vergiler NULL kalır: faturaya geçerken karttan çözülür.
ALTER TABLE "belgeler" ADD COLUMN "toplam_ek_vergi" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN "toplam_stopaj" DECIMAL(15,2) NOT NULL DEFAULT 0;

ALTER TABLE "belge_satirlari" ADD COLUMN "ek_vergiler" JSONB,
ADD COLUMN "ek_vergi_tutari" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN "stopaj_tutari" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- Etki önizlemesi: vergi türü değişikliği taslak teklif/sipariş/irsaliyeleri de sayar.
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
    WHERE b.durum = 'taslak' AND b.tarih >= p_yururluk AND (
      (p_tur = 'kdv_orani' AND EXISTS (SELECT 1 FROM belge_satirlari s WHERE s.belge_id = b.id AND s.kdv_orani::text::numeric = ANY(p_anahtarlar::numeric[])))
      OR (p_tur = 'vergi_turu_kodu' AND EXISTS (SELECT 1 FROM belge_satirlari s, jsonb_array_elements(COALESCE(s.ek_vergiler, '[]'::jsonb)) v WHERE s.belge_id = b.id AND v->>'kod' = ANY(p_anahtarlar)))
    )
  )
  SELECT (SELECT count(*) FROM f), (SELECT count(*) FROM b),
         (SELECT count(DISTINCT t) FROM (SELECT tenant_id t FROM f UNION SELECT tenant_id FROM b) x);
$$;
