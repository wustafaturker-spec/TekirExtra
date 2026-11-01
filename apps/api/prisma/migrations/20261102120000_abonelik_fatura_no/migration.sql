-- PLT-23/32: abonelik faturasının numarası, fatura kesinleştiği anda henüz
-- atanmamış olabiliyor (numara sonra veriliyor); abonelik_faturalari.fatura_no
-- bu durumda boş kalıyordu. Rapor ve firma geçmişi numarayı bağlı faturadan okur.

CREATE OR REPLACE FUNCTION platform_odeme_raporu(p_bas timestamp, p_bit timestamp)
RETURNS TABLE (
  odeme_id uuid, tenant_id uuid, unvan text, vkn text, odeme_at timestamp, ay_sayisi integer,
  tutar numeric, matrah numeric, kdv numeric, kaynak text, saglayici text, kanal text,
  onceki_donem_sonu timestamp, yeni_donem_sonu timestamp, odeme_notu text, kaydeden text,
  fatura_no text, fatura_durumu text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
BEGIN
  IF p_bas IS NULL OR p_bit IS NULL OR p_bit <= p_bas THEN
    RAISE EXCEPTION 'gecersiz_aralik' USING ERRCODE = 'P0001';
  END IF;
  IF p_bit > p_bas + interval '24 months' + interval '1 day' THEN
    RAISE EXCEPTION 'aralik_cok_uzun' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  SELECT o.id, o.tenant_id, t.unvan::text, t.vkn::text, o.created_at, o.ay_sayisi,
         o.tutar, o.matrah, o.kdv, o.kaynak::text, o.saglayici::text,
         (SELECT d.kaynak::text FROM abonelik_odeme_denemeleri d WHERE d.abonelik_odemesi_id = o.id ORDER BY d.created_at LIMIT 1),
         o.onceki_donem_sonu, o.yeni_donem_sonu, o."not"::text, pk.ad_soyad::text,
         COALESCE(f.fatura_no, fa.no)::text, f.durum::text
  FROM abonelik_odemeleri o
  JOIN tenants t ON t.id = o.tenant_id
  LEFT JOIN platform_kullanicilari pk ON pk.id = o.platform_kullanici_id
  LEFT JOIN abonelik_faturalari f ON f.odeme_id = o.id
  LEFT JOIN faturalar fa ON fa.id = f.fatura_id
  WHERE o.created_at >= p_bas AND o.created_at < p_bit
  ORDER BY o.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION platform_firma_abonelik_gecmisi(p_tenant uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT jsonb_build_object(
    'degisiklikler', COALESCE((SELECT jsonb_agg(jsonb_build_object('zaman', d.created_at, 'oncekiPlan', d.onceki_plan, 'yeniPlan', d.yeni_plan, 'oncekiDurum', d.onceki_durum, 'yeniDurum', d.yeni_durum, 'neden', d.neden) ORDER BY d.created_at DESC)
                               FROM abonelik_degisiklikleri d WHERE d.tenant_id = p_tenant), '[]'::jsonb),
    'talepler', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'zaman', r.created_at, 'mevcutPlan', r.mevcut_plan, 'istenenPlan', r.istenen_plan, 'durum', r.durum, 'aciklama', r.aciklama, 'kararNotu', r.karar_notu, 'kararAt', r.karar_at) ORDER BY r.created_at DESC)
                          FROM abonelik_talepleri r WHERE r.tenant_id = p_tenant), '[]'::jsonb),
    'odemeler', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'zaman', o.created_at, 'aySayisi', o.ay_sayisi, 'tutar', o.tutar, 'matrah', o.matrah, 'kdv', o.kdv, 'kaynak', o.kaynak, 'saglayici', o.saglayici, 'not', o."not", 'oncekiDonemSonu', o.onceki_donem_sonu, 'yeniDonemSonu', o.yeni_donem_sonu,
                                                        'fatura', (SELECT jsonb_build_object('no', COALESCE(f.fatura_no, (SELECT fa.no FROM faturalar fa WHERE fa.id = f.fatura_id)), 'durum', f.durum, 'hata', f.hata) FROM abonelik_faturalari f WHERE f.odeme_id = o.id)) ORDER BY o.created_at DESC)
                          FROM abonelik_odemeleri o WHERE o.tenant_id = p_tenant), '[]'::jsonb),
    'basarisizDenemeler', COALESCE((SELECT jsonb_agg(jsonb_build_object('zaman', x.created_at, 'saglayici', x.saglayici, 'kaynak', x.kaynak, 'aySayisi', x.ay_sayisi, 'toplam', x.toplam, 'hata', x.hata_mesaji) ORDER BY x.created_at DESC)
                          FROM (SELECT * FROM abonelik_odeme_denemeleri x WHERE x.tenant_id = p_tenant AND x.durum = 'basarisiz' ORDER BY x.created_at DESC LIMIT 20) x), '[]'::jsonb),
    'askiNedeni', (SELECT a.aski_nedeni FROM tenant_abonelikleri a WHERE a.tenant_id = p_tenant),
    'kart', (SELECT jsonb_build_object('saglayici', k.saglayici, 'son4', k.son4, 'kartMarkasi', k.kart_markasi, 'otomatikYenileme', k.otomatik_yenileme, 'aySayisi', k.ay_sayisi, 'denemeSayisi', k.deneme_sayisi, 'sonDeneme', k.son_deneme_at, 'sonHata', k.son_hata)
             FROM abonelik_kartlari k WHERE k.tenant_id = p_tenant)
  );
$$;
