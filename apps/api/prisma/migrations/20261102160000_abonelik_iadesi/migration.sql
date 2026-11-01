-- PLT-42…46: abonelik ödemesinin platformdan iadesi.

-- Ödeme başına iadeler (ödeyen firmanın satırı, RLS). Yazımı yalnız platform
-- işlevi yapar; uygulama rolü okur ve yalnız faturalayan tarafının durumunu günceller.
CREATE TABLE "abonelik_iadeleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "odeme_id" UUID NOT NULL,
    "tutar" DECIMAL(14,2) NOT NULL,
    "neden" VARCHAR(500) NOT NULL,
    "saglayiciya_gonderildi" BOOLEAN NOT NULL DEFAULT false,
    "saglayici_iade_ref" VARCHAR(100),
    "platform_kullanici_id" UUID,
    "onceki_donem_sonu" TIMESTAMP(3),
    "yeni_donem_sonu" TIMESTAMP(3),
    "islem_anahtari" VARCHAR(100) NOT NULL,
    "faturalayan_durumu" VARCHAR(20) NOT NULL DEFAULT 'bekliyor',
    "faturalayan_hata" VARCHAR(500),
    "faturalayan_deneme" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "abonelik_iadeleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "abonelik_iadeleri_tutar_check" CHECK ("tutar" > 0),
    CONSTRAINT "abonelik_iadeleri_faturalayan_check" CHECK ("faturalayan_durumu" IN ('bekliyor', 'yazildi', 'gerekmiyor', 'hata'))
);
CREATE UNIQUE INDEX "abonelik_iadeleri_islem_anahtari_key" ON "abonelik_iadeleri"("islem_anahtari");
CREATE INDEX "abonelik_iadeleri_tenant_id_odeme_id_idx" ON "abonelik_iadeleri"("tenant_id", "odeme_id");
CREATE INDEX "abonelik_iadeleri_bekleyen_idx" ON "abonelik_iadeleri"("faturalayan_durumu") WHERE "faturalayan_durumu" = 'bekliyor';
ALTER TABLE "abonelik_iadeleri" ADD CONSTRAINT "abonelik_iadeleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "abonelik_iadeleri" ADD CONSTRAINT "abonelik_iadeleri_odeme_id_fkey" FOREIGN KEY ("odeme_id") REFERENCES "abonelik_odemeleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE abonelik_iadeleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE abonelik_iadeleri FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON abonelik_iadeleri USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
-- Varsayılan yetkiler uygulama rolüne yazma verir (bkz. 20261018200000); iade satırını yalnız platform yazar.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON abonelik_iadeleri FROM tekir_app;
GRANT UPDATE (faturalayan_durumu, faturalayan_hata, faturalayan_deneme) ON abonelik_iadeleri TO tekir_app;

-- PLT-42: sağlayıcıya iade sürerken konur; 10 dakikada kendiliğinden düşer.
ALTER TABLE "abonelik_odemeleri" ADD COLUMN "iade_kilidi" TIMESTAMP(3);
-- PLT-45: abonelik faturasına düşen iade toplamı ("iade edildi" / "kısmi iade").
ALTER TABLE "abonelik_faturalari" ADD COLUMN "iade_tutari" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- PLT-42: iade öncesi ödeme bilgisi + kilit. Aynı işlem anahtarıyla yazılmış iade varsa
-- "tekrar" döner ve kilit alınmaz. Kilit tazeyse (10 dk) 'iade_suruyor'.
CREATE FUNCTION platform_abonelik_iade_hazirla(p_odeme uuid, p_anahtar text)
RETURNS TABLE (
  tenant_id uuid, unvan text, tutar numeric, iade_toplami numeric, kaynak text, saglayici text,
  ay_sayisi integer, saglayici_odeme_id text, ortam text, tekrar boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE
  o abonelik_odemeleri%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM abonelik_iadeleri i WHERE i.islem_anahtari = p_anahtar) THEN
    RETURN QUERY SELECT x.tenant_id, t.unvan::text, x.tutar, x.tutar, x.kaynak::text, x.saglayici::text, x.ay_sayisi, NULL::text, NULL::text, true
      FROM abonelik_iadeleri i JOIN abonelik_odemeleri x ON x.id = i.odeme_id JOIN tenants t ON t.id = x.tenant_id WHERE i.islem_anahtari = p_anahtar;
    RETURN;
  END IF;
  SELECT * INTO o FROM abonelik_odemeleri WHERE id = p_odeme FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'odeme_yok' USING ERRCODE = 'P0002'; END IF;
  IF o.iade_kilidi IS NOT NULL AND o.iade_kilidi > now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'iade_suruyor' USING ERRCODE = 'P0001';
  END IF;
  UPDATE abonelik_odemeleri SET iade_kilidi = now() WHERE id = p_odeme;
  RETURN QUERY
  SELECT o.tenant_id, t.unvan::text, o.tutar,
         COALESCE((SELECT sum(i.tutar) FROM abonelik_iadeleri i WHERE i.odeme_id = o.id), 0),
         o.kaynak::text, o.saglayici::text, o.ay_sayisi,
         (SELECT d.saglayici_odeme_id::text FROM abonelik_odeme_denemeleri d WHERE d.abonelik_odemesi_id = o.id AND d.durum = 'odendi' ORDER BY d.created_at LIMIT 1),
         (SELECT d.ortam::text FROM abonelik_odeme_denemeleri d WHERE d.abonelik_odemesi_id = o.id AND d.durum = 'odendi' ORDER BY d.created_at LIMIT 1),
         false
  FROM tenants t WHERE t.id = o.tenant_id;
END;
$$;

CREATE FUNCTION platform_abonelik_iade_kilidi_ac(p_odeme uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  UPDATE abonelik_odemeleri SET iade_kilidi = NULL WHERE id = p_odeme;
$$;

-- PLT-42/43: iade kaydı. Tam iadede dönem sonu ödemenin süresi kadar geri alınır,
-- kısmi iadede dönem değişmez; abonelik geçmişine yazılır, kilit kalkar. Aynı
-- işlem anahtarı ikinci iade üretmez.
CREATE FUNCTION platform_abonelik_iade_kaydet(
  p_odeme uuid, p_tutar numeric, p_neden text, p_platform uuid, p_eposta text,
  p_gonderildi boolean, p_ref text, p_anahtar text
)
RETURNS TABLE (iade_id uuid, tam_iade boolean, onceki_donem_sonu timestamp, yeni_donem_sonu timestamp, tekrar boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE
  o abonelik_odemeleri%ROWTYPE;
  a tenant_abonelikleri%ROWTYPE;
  onceki numeric;
  tam boolean;
  yeni_son timestamp;
  kimlik uuid := gen_random_uuid();
BEGIN
  IF EXISTS (SELECT 1 FROM abonelik_iadeleri i WHERE i.islem_anahtari = p_anahtar) THEN
    RETURN QUERY SELECT i.id, false, i.onceki_donem_sonu, i.yeni_donem_sonu, true FROM abonelik_iadeleri i WHERE i.islem_anahtari = p_anahtar;
    RETURN;
  END IF;
  IF p_tutar IS NULL OR p_tutar <= 0 THEN RAISE EXCEPTION 'gecersiz_tutar' USING ERRCODE = 'P0001'; END IF;
  IF COALESCE(btrim(p_neden), '') = '' THEN RAISE EXCEPTION 'neden_gerekli' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO o FROM abonelik_odemeleri WHERE id = p_odeme FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'odeme_yok' USING ERRCODE = 'P0002'; END IF;
  onceki := COALESCE((SELECT sum(i.tutar) FROM abonelik_iadeleri i WHERE i.odeme_id = o.id), 0);
  IF onceki + p_tutar > o.tutar THEN RAISE EXCEPTION 'fazla_iade' USING ERRCODE = 'P0001'; END IF;
  tam := onceki + p_tutar = o.tutar;
  SELECT * INTO a FROM tenant_abonelikleri WHERE tenant_abonelikleri.tenant_id = o.tenant_id FOR UPDATE;
  IF tam AND a.donem_sonu IS NOT NULL THEN
    yeni_son := a.donem_sonu - make_interval(months => o.ay_sayisi);
    UPDATE tenant_abonelikleri SET donem_sonu = yeni_son, updated_at = now() WHERE tenant_abonelikleri.tenant_id = o.tenant_id;
  END IF;
  INSERT INTO abonelik_iadeleri (id, tenant_id, odeme_id, tutar, neden, saglayiciya_gonderildi, saglayici_iade_ref, platform_kullanici_id,
                                 onceki_donem_sonu, yeni_donem_sonu, islem_anahtari, faturalayan_durumu, created_at)
  VALUES (kimlik, o.tenant_id, o.id, p_tutar, left(btrim(p_neden), 500), p_gonderildi, left(p_ref, 100), p_platform,
          CASE WHEN yeni_son IS NOT NULL THEN a.donem_sonu END, yeni_son, p_anahtar, 'bekliyor', now());
  INSERT INTO abonelik_degisiklikleri (id, tenant_id, onceki_plan, yeni_plan, onceki_durum, yeni_durum, neden, created_at)
  VALUES (gen_random_uuid(), o.tenant_id, a.plan_kodu, a.plan_kodu, a.durum, a.durum,
    format('Ödeme iade edildi (%s): %s TL%s%s — %s', p_eposta, replace(to_char(p_tutar, 'FM999999999990.00'), '.', ','),
      CASE WHEN tam THEN ' (tam iade)' ELSE ' (kısmi iade)' END,
      CASE WHEN yeni_son IS NOT NULL THEN format('; dönem sonu %s → %s', to_char(a.donem_sonu, 'DD.MM.YYYY'), to_char(yeni_son, 'DD.MM.YYYY')) ELSE '' END,
      left(btrim(p_neden), 300)),
    now());
  UPDATE abonelik_odemeleri SET iade_kilidi = NULL WHERE id = o.id;
  RETURN QUERY SELECT kimlik, tam, CASE WHEN yeni_son IS NOT NULL THEN a.donem_sonu END, yeni_son, false;
END;
$$;

-- PLT-44: faturalayan tarafı bekleyen iadeler (worker; uygulama rolü kiracılar arası okur).
CREATE FUNCTION abonelik_bekleyen_iadeler()
RETURNS TABLE (iade_id uuid, tenant_id uuid, odeme_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT i.id, i.tenant_id, i.odeme_id FROM abonelik_iadeleri i
  WHERE i.faturalayan_durumu = 'bekliyor' AND i.faturalayan_deneme < 3
  ORDER BY i.created_at LIMIT 100;
$$;

-- PLT-46: rapora iade tutarı (dönüş tipi değiştiği için yeniden oluşturulur).
DROP FUNCTION platform_odeme_raporu(timestamp, timestamp);
CREATE FUNCTION platform_odeme_raporu(p_bas timestamp, p_bit timestamp)
RETURNS TABLE (
  odeme_id uuid, tenant_id uuid, unvan text, vkn text, odeme_at timestamp, ay_sayisi integer,
  tutar numeric, matrah numeric, kdv numeric, kaynak text, saglayici text, kanal text,
  onceki_donem_sonu timestamp, yeni_donem_sonu timestamp, odeme_notu text, kaydeden text,
  fatura_no text, fatura_durumu text, iade_tutari numeric
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
         COALESCE(f.fatura_no, fa.no)::text, f.durum::text,
         COALESCE((SELECT sum(i.tutar) FROM abonelik_iadeleri i WHERE i.odeme_id = o.id), 0)
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
                                                        'iadeler', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'zaman', i.created_at, 'tutar', i.tutar, 'neden', i.neden, 'saglayiciyaGonderildi', i.saglayiciya_gonderildi, 'ref', i.saglayici_iade_ref, 'kaydeden', pk.ad_soyad, 'faturalayanDurumu', i.faturalayan_durumu, 'faturalayanHata', i.faturalayan_hata) ORDER BY i.created_at)
                                                                             FROM abonelik_iadeleri i LEFT JOIN platform_kullanicilari pk ON pk.id = i.platform_kullanici_id WHERE i.odeme_id = o.id), '[]'::jsonb),
                                                        'fatura', (SELECT jsonb_build_object('no', COALESCE(f.fatura_no, (SELECT fa.no FROM faturalar fa WHERE fa.id = f.fatura_id)), 'durum', f.durum, 'hata', f.hata) FROM abonelik_faturalari f WHERE f.odeme_id = o.id)) ORDER BY o.created_at DESC)
                          FROM abonelik_odemeleri o WHERE o.tenant_id = p_tenant), '[]'::jsonb),
    'basarisizDenemeler', COALESCE((SELECT jsonb_agg(jsonb_build_object('zaman', x.created_at, 'saglayici', x.saglayici, 'kaynak', x.kaynak, 'aySayisi', x.ay_sayisi, 'toplam', x.toplam, 'hata', x.hata_mesaji) ORDER BY x.created_at DESC)
                          FROM (SELECT * FROM abonelik_odeme_denemeleri x WHERE x.tenant_id = p_tenant AND x.durum = 'basarisiz' ORDER BY x.created_at DESC LIMIT 20) x), '[]'::jsonb),
    'askiNedeni', (SELECT a.aski_nedeni FROM tenant_abonelikleri a WHERE a.tenant_id = p_tenant),
    'kart', (SELECT jsonb_build_object('saglayici', k.saglayici, 'son4', k.son4, 'kartMarkasi', k.kart_markasi, 'otomatikYenileme', k.otomatik_yenileme, 'aySayisi', k.ay_sayisi, 'denemeSayisi', k.deneme_sayisi, 'sonDeneme', k.son_deneme_at, 'sonHata', k.son_hata)
             FROM abonelik_kartlari k WHERE k.tenant_id = p_tenant)
  );
$$;

CREATE OR REPLACE FUNCTION platform_faturasiz_abonelik_odemeleri(p_hepsi boolean DEFAULT false)
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
    -- PLT-43: tam iade edilmiş ödeme faturalanmaz.
    AND o.tutar > COALESCE((SELECT sum(i.tutar) FROM abonelik_iadeleri i WHERE i.odeme_id = o.id), 0)
    AND NOT EXISTS (SELECT 1 FROM abonelik_faturalari f WHERE f.odeme_id = o.id AND (f.fatura_id IS NOT NULL OR (NOT p_hepsi AND f.deneme >= 3)))
  ORDER BY o.created_at
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION platform_abonelik_iade_hazirla(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_abonelik_iade_kilidi_ac(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_abonelik_iade_kaydet(uuid, numeric, text, uuid, text, boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION abonelik_bekleyen_iadeler() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_odeme_raporu(timestamp, timestamp) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_abonelik_iade_hazirla(uuid, text) TO tekir_platform;
GRANT EXECUTE ON FUNCTION platform_abonelik_iade_kilidi_ac(uuid) TO tekir_platform;
GRANT EXECUTE ON FUNCTION platform_abonelik_iade_kaydet(uuid, numeric, text, uuid, text, boolean, text, text) TO tekir_platform;
GRANT EXECUTE ON FUNCTION abonelik_bekleyen_iadeler() TO tekir_app;
GRANT EXECUTE ON FUNCTION platform_odeme_raporu(timestamp, timestamp) TO tekir_platform;
