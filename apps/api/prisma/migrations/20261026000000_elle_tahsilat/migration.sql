-- PLT-09: elle tahsilat takibi. Platform "ödeme alındı" işaretleyerek dönemi
-- uzatır; hatırlatma ve "askıya alınacaklar" listesi dönem sonundan hesaplanır.
-- Otomatik askı yoktur. Platform rolü kiracı tablolarına yalnız aşağıdaki dar
-- SECURITY DEFINER işlevleriyle dokunur.

CREATE TABLE "abonelik_odemeleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ay_sayisi" INTEGER NOT NULL,
    "tutar" DECIMAL(14,2) NOT NULL,
    "not" VARCHAR(500),
    "onceki_donem_sonu" TIMESTAMP(3),
    "yeni_donem_sonu" TIMESTAMP(3) NOT NULL,
    "platform_kullanici_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "abonelik_odemeleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "abonelik_odemeleri_ay_check" CHECK ("ay_sayisi" IN (1, 3, 6, 12)),
    CONSTRAINT "abonelik_odemeleri_tutar_check" CHECK ("tutar" >= 0)
);
CREATE INDEX "abonelik_odemeleri_tenant_id_created_at_idx" ON "abonelik_odemeleri"("tenant_id", "created_at");
ALTER TABLE "abonelik_odemeleri" ADD CONSTRAINT "abonelik_odemeleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE abonelik_odemeleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE abonelik_odemeleri FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON abonelik_odemeleri USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);

-- "Ödeme alındı": dönem sonu N ay uzar. Dönemi olmayan (eski) kayıtta dönem
-- bugün başlar. Durum değişmez (askıdaki firmayı açmak ayrı karardır).
CREATE FUNCTION platform_odeme_kaydet(p_tenant uuid, p_ay integer, p_tutar numeric, p_not text, p_platform uuid, p_eposta text)
RETURNS timestamp
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE
  eski tenant_abonelikleri%ROWTYPE;
  yeni_son timestamp;
BEGIN
  IF p_ay NOT IN (1, 3, 6, 12) THEN RAISE EXCEPTION 'gecersiz_sure' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant) THEN
    RAISE EXCEPTION 'firma_yok' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO tenant_abonelikleri (id, tenant_id, plan_kodu, durum, created_at, updated_at)
  VALUES (gen_random_uuid(), p_tenant, 'v1', 'aktif', now(), now())
  ON CONFLICT (tenant_id) DO NOTHING;
  SELECT * INTO eski FROM tenant_abonelikleri WHERE tenant_id = p_tenant FOR UPDATE;
  yeni_son := COALESCE(eski.donem_sonu, now()) + make_interval(months => p_ay);
  UPDATE tenant_abonelikleri SET
    donem_baslangici = COALESCE(donem_baslangici, now()),
    donem_sonu = yeni_son,
    updated_at = now()
  WHERE tenant_id = p_tenant;
  INSERT INTO abonelik_odemeleri (id, tenant_id, ay_sayisi, tutar, "not", onceki_donem_sonu, yeni_donem_sonu, platform_kullanici_id, created_at)
  VALUES (gen_random_uuid(), p_tenant, p_ay, p_tutar, p_not, eski.donem_sonu, yeni_son, p_platform, now());
  INSERT INTO abonelik_degisiklikleri (id, tenant_id, onceki_plan, yeni_plan, onceki_durum, yeni_durum, neden, created_at)
  VALUES (gen_random_uuid(), p_tenant, eski.plan_kodu, eski.plan_kodu, eski.durum, eski.durum,
    format('Ödeme alındı (%s): %s ay, %s TL; dönem sonu %s', p_eposta, p_ay, replace(to_char(p_tutar, 'FM999999999990.00'), '.', ','), to_char(yeni_son, 'DD.MM.YYYY')) || COALESCE(' — ' || NULLIF(p_not, ''), ''),
    now());
  RETURN yeni_son;
END;
$$;

-- Hatırlatma adayları: dönemi tanımlı, aktif ya da denemedeki firmalar; fatura
-- e-postası ve aktif yöneticilerin adresleri (içerik yok).
CREATE FUNCTION platform_tahsilat_adaylari()
RETURNS TABLE (tenant_id uuid, unvan text, plan_kodu text, durum text, donem_sonu timestamp, fatura_epostasi text, yonetici_epostalari text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT t.id, t.unvan, a.plan_kodu, a.durum::text, a.donem_sonu, a.fatura_epostasi,
         COALESCE((SELECT array_agg(u.eposta ORDER BY u.eposta) FROM users u WHERE u.tenant_id = t.id AND u.aktif AND u.rol = 'yonetici'), ARRAY[]::text[])
  FROM tenant_abonelikleri a JOIN tenants t ON t.id = a.tenant_id
  WHERE a.donem_sonu IS NOT NULL AND a.durum IN ('aktif', 'deneme');
$$;

-- Firma genel bakışına son ödeme ve "askıya alınacak" (dönem sonundan 15 gün geçti) eklenir.
DROP FUNCTION platform_firma_ozeti();
CREATE FUNCTION platform_firma_ozeti()
RETURNS TABLE (
  tenant_id uuid, unvan text, vkn text, kayit_tarihi timestamp,
  plan_kodu text, durum text, donem_sonu timestamp, iptal_tarihi timestamp,
  aktif_kullanici bigint, son_giris timestamp, ebelge_saglayici text,
  bekleyen_talep_id uuid, bekleyen_plan text,
  son_odeme_at timestamp, askiya_alinacak boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT t.id, t.unvan, t.vkn, t.created_at,
         COALESCE(a.plan_kodu, 'v1'), COALESCE(a.durum::text, 'aktif'), a.donem_sonu, a.iptal_tarihi,
         (SELECT count(*) FROM users u WHERE u.tenant_id = t.id AND u.aktif AND u.rol <> 'calisan'),
         (SELECT max(u.son_giris_at) FROM users u WHERE u.tenant_id = t.id),
         (SELECT b.saglayici FROM baglantilar b WHERE b.tenant_id = t.id AND b.aile = 'ebelge' AND b.durum = 'aktif' LIMIT 1),
         at.id, at.istenen_plan,
         (SELECT max(o.created_at) FROM abonelik_odemeleri o WHERE o.tenant_id = t.id),
         COALESCE(a.durum IN ('aktif', 'deneme') AND a.donem_sonu < now() - interval '15 days', false)
  FROM tenants t
  LEFT JOIN tenant_abonelikleri a ON a.tenant_id = t.id
  LEFT JOIN abonelik_talepleri at ON at.tenant_id = t.id AND at.durum = 'bekliyor'
  ORDER BY (at.id IS NULL), t.unvan;
$$;

CREATE OR REPLACE FUNCTION platform_firma_abonelik_gecmisi(p_tenant uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT jsonb_build_object(
    'degisiklikler', COALESCE((SELECT jsonb_agg(jsonb_build_object('zaman', d.created_at, 'oncekiPlan', d.onceki_plan, 'yeniPlan', d.yeni_plan, 'oncekiDurum', d.onceki_durum, 'yeniDurum', d.yeni_durum, 'neden', d.neden) ORDER BY d.created_at DESC)
                               FROM abonelik_degisiklikleri d WHERE d.tenant_id = p_tenant), '[]'::jsonb),
    'talepler', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'zaman', r.created_at, 'mevcutPlan', r.mevcut_plan, 'istenenPlan', r.istenen_plan, 'durum', r.durum, 'aciklama', r.aciklama, 'kararNotu', r.karar_notu, 'kararAt', r.karar_at) ORDER BY r.created_at DESC)
                          FROM abonelik_talepleri r WHERE r.tenant_id = p_tenant), '[]'::jsonb),
    'odemeler', COALESCE((SELECT jsonb_agg(jsonb_build_object('zaman', o.created_at, 'aySayisi', o.ay_sayisi, 'tutar', o.tutar, 'not', o."not", 'oncekiDonemSonu', o.onceki_donem_sonu, 'yeniDonemSonu', o.yeni_donem_sonu) ORDER BY o.created_at DESC)
                          FROM abonelik_odemeleri o WHERE o.tenant_id = p_tenant), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION platform_odeme_kaydet(uuid, integer, numeric, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_tahsilat_adaylari() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_firma_ozeti() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_odeme_kaydet(uuid, integer, numeric, text, uuid, text) TO tekir_platform;
GRANT EXECUTE ON FUNCTION platform_tahsilat_adaylari() TO tekir_platform;
GRANT EXECUTE ON FUNCTION platform_firma_ozeti() TO tekir_platform;
