-- PLT-20…23: abonelik ödemelerinin faturalayan firmada (TekirExtra'nın kendi
-- kiracısı) taslak faturaya dönüşmesi ve fatura kesinleşince tahsil edilmesi.

-- PLT-20: tek satırlık ayar; yalnız platform yazar. `baslangic_at`ten önceki
-- ödemeler faturalanmaz (ayar açılınca geçmiş ödemeler topluca faturalanmasın).
CREATE TABLE abonelik_fatura_ayari (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  faturalayan_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  -- Kartla ve elle alınan ödemelerin tahsilat hesabı (faturalayan firmada).
  kart_hesap_tur VARCHAR(10) CHECK (kart_hesap_tur IN ('kasa', 'banka', 'pos')),
  kart_hesap_id UUID,
  elle_hesap_tur VARCHAR(10) CHECK (elle_hesap_tur IN ('kasa', 'banka', 'pos')),
  elle_hesap_id UUID,
  baslangic_at TIMESTAMP(3),
  guncelleyen_id UUID REFERENCES platform_kullanicilari(id),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
GRANT SELECT ON abonelik_fatura_ayari TO tekir_app;
GRANT SELECT, INSERT, UPDATE ON abonelik_fatura_ayari TO tekir_platform;

-- PLT-21…23: ödeme başına tek fatura (ve tek tahsilat). İki kiracıyı bağlar
-- (ödeyen ve faturalayan); kiracı satırı değildir, uygulama rolü yazar.
CREATE TABLE abonelik_faturalari (
  odeme_id UUID PRIMARY KEY REFERENCES abonelik_odemeleri(id) ON DELETE CASCADE,
  odeyen_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  faturalayan_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fatura_id UUID,
  fatura_no VARCHAR(40),
  durum VARCHAR(20) NOT NULL DEFAULT 'bekliyor' CHECK (durum IN ('bekliyor', 'taslak', 'kesinlesti', 'tahsil_edildi', 'hata')),
  hata VARCHAR(500),
  tahsilat_hareket_id UUID,
  deneme INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX abonelik_faturalari_fatura_key ON abonelik_faturalari (faturalayan_tenant_id, fatura_id) WHERE fatura_id IS NOT NULL;
CREATE INDEX abonelik_faturalari_odeyen_idx ON abonelik_faturalari (odeyen_tenant_id);
GRANT SELECT, INSERT, UPDATE ON abonelik_faturalari TO tekir_app;
GRANT SELECT ON abonelik_faturalari TO tekir_platform;

-- Faturası henüz açılmamış ödemeler + faturaya gerekecek alıcı bilgisi
-- (unvan, VKN, vergi dairesi, adres, fatura e-postası). Faturalayan firmanın
-- kendi ödemeleri ve ayar başlangıcından önceki ödemeler dahil değildir.
-- Otomatik çalışma 3 başarısız denemede durur; elle yeniden deneme (p_hepsi) sınıra bakmaz.
CREATE FUNCTION platform_faturasiz_abonelik_odemeleri(p_hepsi boolean DEFAULT false)
RETURNS TABLE (
  odeme_id uuid, tenant_id uuid, odeme_at timestamp, ay_sayisi integer, tutar numeric, matrah numeric, kdv numeric,
  kaynak text, saglayici text, onceki_donem_sonu timestamp, yeni_donem_sonu timestamp, plan_kodu text,
  unvan text, faturalandirma_unvani text, vkn text, vergi_dairesi text, adres text, il text, ilce text, posta_kodu text, eposta text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT o.id, o.tenant_id, o.created_at, o.ay_sayisi, o.tutar, o.matrah, o.kdv, o.kaynak, o.saglayici, o.onceki_donem_sonu, o.yeni_donem_sonu,
         COALESCE(a.plan_kodu, 'v1'), t.unvan, a.faturalandirma_unvani, t.vkn, t.vergi_dairesi, t.adres, t.il, t.ilce, t.posta_kodu,
         COALESCE(NULLIF(a.fatura_epostasi, ''), t.eposta)
  FROM abonelik_odemeleri o
  JOIN tenants t ON t.id = o.tenant_id
  LEFT JOIN tenant_abonelikleri a ON a.tenant_id = o.tenant_id
  CROSS JOIN abonelik_fatura_ayari y
  WHERE y.faturalayan_tenant_id IS NOT NULL AND y.baslangic_at IS NOT NULL
    AND o.created_at >= y.baslangic_at
    AND o.tenant_id <> y.faturalayan_tenant_id
    AND o.tutar > 0
    AND NOT EXISTS (SELECT 1 FROM abonelik_faturalari f WHERE f.odeme_id = o.id AND (f.fatura_id IS NOT NULL OR (NOT p_hepsi AND f.deneme >= 3)))
  ORDER BY o.created_at
  LIMIT 200;
$$;

-- PLT-20 ekranı: faturalayan firmanın tahsilat hesapları (yalnız ad ve tür).
CREATE FUNCTION platform_tahsilat_hesaplari(p_tenant uuid)
RETURNS TABLE (tur text, id uuid, ad text, doviz text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT 'kasa', k.id, k.ad, k.doviz_cinsi::text FROM kasalar k WHERE k.tenant_id = p_tenant AND k.aktif
  UNION ALL
  SELECT 'banka', b.id, b.ad || ' (' || b.banka_adi || ')', b.doviz_cinsi::text FROM banka_hesaplari b WHERE b.tenant_id = p_tenant AND b.aktif
  UNION ALL
  SELECT 'pos', p.id, p.ad || ' (' || p.saglayici || ')', p.doviz_cinsi::text FROM pos_hesaplari p WHERE p.tenant_id = p_tenant AND p.aktif
  ORDER BY 1, 3;
$$;

REVOKE ALL ON FUNCTION platform_faturasiz_abonelik_odemeleri(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_tahsilat_hesaplari(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_faturasiz_abonelik_odemeleri(boolean) TO tekir_platform;
GRANT EXECUTE ON FUNCTION platform_tahsilat_hesaplari(uuid) TO tekir_platform;

-- PLT-23: firma ayrıntısında ödeme satırı faturasıyla eşlensin diye ödeme kimliği eklenir.
CREATE OR REPLACE FUNCTION platform_firma_abonelik_gecmisi(p_tenant uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT jsonb_build_object(
    'degisiklikler', COALESCE((SELECT jsonb_agg(jsonb_build_object('zaman', d.created_at, 'oncekiPlan', d.onceki_plan, 'yeniPlan', d.yeni_plan, 'oncekiDurum', d.onceki_durum, 'yeniDurum', d.yeni_durum, 'neden', d.neden) ORDER BY d.created_at DESC)
                               FROM abonelik_degisiklikleri d WHERE d.tenant_id = p_tenant), '[]'::jsonb),
    'talepler', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'zaman', r.created_at, 'mevcutPlan', r.mevcut_plan, 'istenenPlan', r.istenen_plan, 'durum', r.durum, 'aciklama', r.aciklama, 'kararNotu', r.karar_notu, 'kararAt', r.karar_at) ORDER BY r.created_at DESC)
                          FROM abonelik_talepleri r WHERE r.tenant_id = p_tenant), '[]'::jsonb),
    'odemeler', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'zaman', o.created_at, 'aySayisi', o.ay_sayisi, 'tutar', o.tutar, 'matrah', o.matrah, 'kdv', o.kdv, 'kaynak', o.kaynak, 'saglayici', o.saglayici, 'not', o."not", 'oncekiDonemSonu', o.onceki_donem_sonu, 'yeniDonemSonu', o.yeni_donem_sonu,
                                                        'fatura', (SELECT jsonb_build_object('no', f.fatura_no, 'durum', f.durum, 'hata', f.hata) FROM abonelik_faturalari f WHERE f.odeme_id = o.id)) ORDER BY o.created_at DESC)
                          FROM abonelik_odemeleri o WHERE o.tenant_id = p_tenant), '[]'::jsonb),
    'basarisizDenemeler', COALESCE((SELECT jsonb_agg(jsonb_build_object('zaman', x.created_at, 'saglayici', x.saglayici, 'kaynak', x.kaynak, 'aySayisi', x.ay_sayisi, 'toplam', x.toplam, 'hata', x.hata_mesaji) ORDER BY x.created_at DESC)
                          FROM (SELECT * FROM abonelik_odeme_denemeleri x WHERE x.tenant_id = p_tenant AND x.durum = 'basarisiz' ORDER BY x.created_at DESC LIMIT 20) x), '[]'::jsonb),
    'askiNedeni', (SELECT a.aski_nedeni FROM tenant_abonelikleri a WHERE a.tenant_id = p_tenant),
    'kart', (SELECT jsonb_build_object('saglayici', k.saglayici, 'son4', k.son4, 'kartMarkasi', k.kart_markasi, 'otomatikYenileme', k.otomatik_yenileme, 'aySayisi', k.ay_sayisi, 'denemeSayisi', k.deneme_sayisi, 'sonDeneme', k.son_deneme_at, 'sonHata', k.son_hata)
             FROM abonelik_kartlari k WHERE k.tenant_id = p_tenant)
  );
$$;
