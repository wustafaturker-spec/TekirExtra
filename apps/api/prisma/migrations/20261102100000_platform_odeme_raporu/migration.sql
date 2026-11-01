-- PLT-32…37: platform ödeme raporu. Platform rolü kiracı tablolarını doğrudan
-- okuyamaz; yalnız aşağıdaki salt-okunur SECURITY DEFINER işlevleri çağırır.
-- Ödeyen IP, sağlayıcı belirteçleri ve kart anahtarları hiçbir işlevden dönmez.

-- PLT-32/33/34/37: [p_bas, p_bit) aralığındaki ödemeler; aralık en çok 24 ay.
CREATE FUNCTION platform_odeme_raporu(p_bas timestamp, p_bit timestamp)
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
         f.fatura_no::text, f.durum::text
  FROM abonelik_odemeleri o
  JOIN tenants t ON t.id = o.tenant_id
  LEFT JOIN platform_kullanicilari pk ON pk.id = o.platform_kullanici_id
  LEFT JOIN abonelik_faturalari f ON f.odeme_id = o.id
  WHERE o.created_at >= p_bas AND o.created_at < p_bit
  ORDER BY o.created_at DESC;
END;
$$;

-- PLT-35: başarısız denemeler ve 1 saatten uzun süredir sonuçlanmamış denemeler.
CREATE FUNCTION platform_sorunlu_odeme_denemeleri(p_bas timestamp, p_bit timestamp)
RETURNS TABLE (
  deneme_id uuid, tenant_id uuid, unvan text, zaman timestamp, saglayici text, ortam text, kaynak text,
  ay_sayisi integer, toplam numeric, durum text, hata text
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
  SELECT d.id, d.tenant_id, t.unvan::text, d.created_at, d.saglayici::text, d.ortam::text, d.kaynak::text,
         d.ay_sayisi, d.toplam, d.durum::text, d.hata_mesaji::text
  FROM abonelik_odeme_denemeleri d
  JOIN tenants t ON t.id = d.tenant_id
  WHERE d.created_at >= p_bas AND d.created_at < p_bit
    AND (d.durum = 'basarisiz' OR (d.durum = 'baslatildi' AND d.created_at < now() - interval '1 hour'))
  ORDER BY d.created_at DESC
  LIMIT 500;
END;
$$;

-- PLT-35: son otomatik yenileme denemesi başarısız olan kayıtlı kartlar.
CREATE FUNCTION platform_kart_sorunlari()
RETURNS TABLE (
  tenant_id uuid, unvan text, saglayici text, son4 text, kart_markasi text, otomatik_yenileme boolean,
  ay_sayisi integer, deneme_sayisi integer, son_deneme_at timestamp, son_hata text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT k.tenant_id, t.unvan::text, k.saglayici::text, k.son4::text, k.kart_markasi::text, k.otomatik_yenileme,
         k.ay_sayisi, k.deneme_sayisi, k.son_deneme_at, k.son_hata::text
  FROM abonelik_kartlari k
  JOIN tenants t ON t.id = k.tenant_id
  WHERE k.son_hata IS NOT NULL
  ORDER BY k.son_deneme_at DESC NULLS LAST;
$$;

-- PLT-36: dönemi p_gun gün içinde bitecek ya da bitmiş (iptal olmayan) firmalar.
CREATE FUNCTION platform_yaklasan_yenilemeler(p_gun integer)
RETURNS TABLE (
  tenant_id uuid, unvan text, plan_kodu text, durum text, donem_sonu timestamp,
  kart_var boolean, saglayici text, son4 text, kart_markasi text, otomatik_yenileme boolean, kart_ay_sayisi integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
BEGIN
  IF p_gun IS NULL OR p_gun < 1 OR p_gun > 90 THEN
    RAISE EXCEPTION 'gecersiz_gun' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  SELECT a.tenant_id, t.unvan::text, COALESCE(a.plan_kodu, 'v1')::text, a.durum::text, a.donem_sonu,
         k.tenant_id IS NOT NULL, k.saglayici::text, k.son4::text, k.kart_markasi::text, k.otomatik_yenileme, k.ay_sayisi
  FROM tenant_abonelikleri a
  JOIN tenants t ON t.id = a.tenant_id
  LEFT JOIN abonelik_kartlari k ON k.tenant_id = a.tenant_id
  WHERE a.donem_sonu IS NOT NULL
    AND a.durum <> 'iptal'
    AND a.donem_sonu < now() + make_interval(days => p_gun)
  ORDER BY a.donem_sonu;
END;
$$;

REVOKE ALL ON FUNCTION platform_odeme_raporu(timestamp, timestamp) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_sorunlu_odeme_denemeleri(timestamp, timestamp) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_kart_sorunlari() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_yaklasan_yenilemeler(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_odeme_raporu(timestamp, timestamp) TO tekir_platform;
GRANT EXECUTE ON FUNCTION platform_sorunlu_odeme_denemeleri(timestamp, timestamp) TO tekir_platform;
GRANT EXECUTE ON FUNCTION platform_kart_sorunlari() TO tekir_platform;
GRANT EXECUTE ON FUNCTION platform_yaklasan_yenilemeler(integer) TO tekir_platform;
