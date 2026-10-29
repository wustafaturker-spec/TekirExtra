-- PLT-14: isteğe bağlı otomatik yenileme. Kart sağlayıcıda saklanır; burada
-- yalnız sağlayıcının kart anahtarları (şifreli) ve maskeli son 4 hane durur.
CREATE TABLE abonelik_kartlari (
  tenant_id UUID NOT NULL,
  saglayici VARCHAR(20) NOT NULL,
  ortam VARCHAR(10) NOT NULL,
  sifreli_anahtarlar TEXT NOT NULL,
  son4 VARCHAR(4),
  kart_markasi VARCHAR(40),
  otomatik_yenileme BOOLEAN NOT NULL DEFAULT true,
  ay_sayisi INTEGER NOT NULL CHECK (ay_sayisi IN (1, 3, 6, 12)),
  -- PayTR tekrarlayan ödemesi kartı kaydeden kişinin IP'sini ister.
  odeyen_ip VARCHAR(45),
  kaydeden_user_id UUID,
  -- Denemeler bu dönem sonu için sayılır; dönem değişince sayaç sıfırlanır.
  yenileme_donem_sonu TIMESTAMP(3),
  deneme_sayisi INTEGER NOT NULL DEFAULT 0,
  son_deneme_at TIMESTAMP(3),
  son_hata VARCHAR(500),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT abonelik_kartlari_pkey PRIMARY KEY (tenant_id)
);
ALTER TABLE abonelik_kartlari ADD CONSTRAINT abonelik_kartlari_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE abonelik_kartlari ENABLE ROW LEVEL SECURITY;
ALTER TABLE abonelik_kartlari FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON abonelik_kartlari USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- PayTR'da kart bildirimle sonradan gelir; formu açan IP girişimde tutulur.
ALTER TABLE abonelik_odeme_denemeleri ADD COLUMN odeyen_ip VARCHAR(45);

-- Worker'ın aday listesi: otomatik yenilemesi açık, aktif ya da denemedeki,
-- dönemi 3 gün içinde bitecek (ya da en çok 3 gün önce bitmiş) firmalar.
-- Askıdaki ve iptal dönemindeki firma listeye girmez. Yalnız kimlik ve tarih döner.
CREATE FUNCTION platform_otomatik_yenileme_adaylari()
RETURNS TABLE (tenant_id uuid, donem_sonu timestamp)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT k.tenant_id, a.donem_sonu
  FROM abonelik_kartlari k JOIN tenant_abonelikleri a ON a.tenant_id = k.tenant_id
  WHERE k.otomatik_yenileme AND a.durum IN ('aktif', 'deneme') AND a.donem_sonu IS NOT NULL
    AND a.donem_sonu <= now() + interval '3 days' AND a.donem_sonu > now() - interval '3 days';
$$;
REVOKE ALL ON FUNCTION platform_otomatik_yenileme_adaylari() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_otomatik_yenileme_adaylari() TO tekir_platform;

-- PLT-15: firma ayrıntısında otomatik yenileme durumu (kart anahtarları dönmez).
CREATE OR REPLACE FUNCTION platform_firma_abonelik_gecmisi(p_tenant uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT jsonb_build_object(
    'degisiklikler', COALESCE((SELECT jsonb_agg(jsonb_build_object('zaman', d.created_at, 'oncekiPlan', d.onceki_plan, 'yeniPlan', d.yeni_plan, 'oncekiDurum', d.onceki_durum, 'yeniDurum', d.yeni_durum, 'neden', d.neden) ORDER BY d.created_at DESC)
                               FROM abonelik_degisiklikleri d WHERE d.tenant_id = p_tenant), '[]'::jsonb),
    'talepler', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'zaman', r.created_at, 'mevcutPlan', r.mevcut_plan, 'istenenPlan', r.istenen_plan, 'durum', r.durum, 'aciklama', r.aciklama, 'kararNotu', r.karar_notu, 'kararAt', r.karar_at) ORDER BY r.created_at DESC)
                          FROM abonelik_talepleri r WHERE r.tenant_id = p_tenant), '[]'::jsonb),
    'odemeler', COALESCE((SELECT jsonb_agg(jsonb_build_object('zaman', o.created_at, 'aySayisi', o.ay_sayisi, 'tutar', o.tutar, 'matrah', o.matrah, 'kdv', o.kdv, 'kaynak', o.kaynak, 'saglayici', o.saglayici, 'not', o."not", 'oncekiDonemSonu', o.onceki_donem_sonu, 'yeniDonemSonu', o.yeni_donem_sonu) ORDER BY o.created_at DESC)
                          FROM abonelik_odemeleri o WHERE o.tenant_id = p_tenant), '[]'::jsonb),
    'basarisizDenemeler', COALESCE((SELECT jsonb_agg(jsonb_build_object('zaman', x.created_at, 'saglayici', x.saglayici, 'kaynak', x.kaynak, 'aySayisi', x.ay_sayisi, 'toplam', x.toplam, 'hata', x.hata_mesaji) ORDER BY x.created_at DESC)
                          FROM (SELECT * FROM abonelik_odeme_denemeleri x WHERE x.tenant_id = p_tenant AND x.durum = 'basarisiz' ORDER BY x.created_at DESC LIMIT 20) x), '[]'::jsonb),
    'askiNedeni', (SELECT a.aski_nedeni FROM tenant_abonelikleri a WHERE a.tenant_id = p_tenant),
    'kart', (SELECT jsonb_build_object('saglayici', k.saglayici, 'son4', k.son4, 'kartMarkasi', k.kart_markasi, 'otomatikYenileme', k.otomatik_yenileme, 'aySayisi', k.ay_sayisi, 'denemeSayisi', k.deneme_sayisi, 'sonDeneme', k.son_deneme_at, 'sonHata', k.son_hata)
             FROM abonelik_kartlari k WHERE k.tenant_id = p_tenant)
  );
$$;
