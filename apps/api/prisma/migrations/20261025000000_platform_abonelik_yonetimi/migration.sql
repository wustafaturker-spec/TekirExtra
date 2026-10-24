-- Platform P0-1 / P1-1: plan değişikliği talep + platform onayı, askıya alma, firma genel bakışı.
-- Platform rolü (tekir_platform) kiracı tablolarını okuyamaz; yalnız aşağıdaki dar
-- SECURITY DEFINER işlevlerini çağırır (platform_ai_kiraci_ozeti kalıbı).

CREATE TABLE "abonelik_talepleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "mevcut_plan" TEXT NOT NULL,
    "istenen_plan" TEXT NOT NULL,
    "durum" TEXT NOT NULL DEFAULT 'bekliyor',
    "aciklama" VARCHAR(500),
    "karar_notu" VARCHAR(500),
    "isteyen_user_id" UUID NOT NULL,
    "karar_veren_platform_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "karar_at" TIMESTAMP(3),
    CONSTRAINT "abonelik_talepleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "abonelik_talepleri_durum_check" CHECK ("durum" IN ('bekliyor', 'onaylandi', 'reddedildi', 'geri_cekildi'))
);
CREATE INDEX "abonelik_talepleri_tenant_id_created_at_idx" ON "abonelik_talepleri"("tenant_id", "created_at");
-- Firma başına tek bekleyen talep.
CREATE UNIQUE INDEX "abonelik_talepleri_bekleyen_tekil" ON "abonelik_talepleri"("tenant_id") WHERE "durum" = 'bekliyor';
ALTER TABLE "abonelik_talepleri" ADD CONSTRAINT "abonelik_talepleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE abonelik_talepleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE abonelik_talepleri FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON abonelik_talepleri USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);

-- Firma genel bakışı: içerik yok, yalnız yönetim için gereken sayılar ve durumlar.
CREATE FUNCTION platform_firma_ozeti()
RETURNS TABLE (
  tenant_id uuid, unvan text, vkn text, kayit_tarihi timestamp,
  plan_kodu text, durum text, donem_sonu timestamp, iptal_tarihi timestamp,
  aktif_kullanici bigint, son_giris timestamp, ebelge_saglayici text,
  bekleyen_talep_id uuid, bekleyen_plan text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT t.id, t.unvan, t.vkn, t.created_at,
         COALESCE(a.plan_kodu, 'v1'), COALESCE(a.durum::text, 'aktif'), a.donem_sonu, a.iptal_tarihi,
         (SELECT count(*) FROM users u WHERE u.tenant_id = t.id AND u.aktif AND u.rol <> 'calisan'),
         (SELECT max(u.son_giris_at) FROM users u WHERE u.tenant_id = t.id),
         (SELECT b.saglayici FROM baglantilar b WHERE b.tenant_id = t.id AND b.aile = 'ebelge' AND b.durum = 'aktif' LIMIT 1),
         at.id, at.istenen_plan
  FROM tenants t
  LEFT JOIN tenant_abonelikleri a ON a.tenant_id = t.id
  LEFT JOIN abonelik_talepleri at ON at.tenant_id = t.id AND at.durum = 'bekliyor'
  ORDER BY (at.id IS NULL), t.unvan;
$$;

-- Firma ayrıntısı: abonelik değişiklikleri ve talepler.
CREATE FUNCTION platform_firma_abonelik_gecmisi(p_tenant uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT jsonb_build_object(
    'degisiklikler', COALESCE((SELECT jsonb_agg(jsonb_build_object('zaman', d.created_at, 'oncekiPlan', d.onceki_plan, 'yeniPlan', d.yeni_plan, 'oncekiDurum', d.onceki_durum, 'yeniDurum', d.yeni_durum, 'neden', d.neden) ORDER BY d.created_at DESC)
                               FROM abonelik_degisiklikleri d WHERE d.tenant_id = p_tenant), '[]'::jsonb),
    'talepler', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'zaman', r.created_at, 'mevcutPlan', r.mevcut_plan, 'istenenPlan', r.istenen_plan, 'durum', r.durum, 'aciklama', r.aciklama, 'kararNotu', r.karar_notu, 'kararAt', r.karar_at) ORDER BY r.created_at DESC)
                          FROM abonelik_talepleri r WHERE r.tenant_id = p_tenant), '[]'::jsonb)
  );
$$;

-- Plan ve/veya durum değişikliği (platform). Plan kodu uygulamada katalogdan doğrulanır.
CREATE FUNCTION platform_abonelik_guncelle(p_tenant uuid, p_plan text, p_durum text, p_neden text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE
  eski tenant_abonelikleri%ROWTYPE;
  yeni_plan text;
  yeni_durum "AbonelikDurumu";
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant) THEN
    RAISE EXCEPTION 'firma_yok' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO tenant_abonelikleri (id, tenant_id, plan_kodu, durum, created_at, updated_at)
  VALUES (gen_random_uuid(), p_tenant, 'v1', 'aktif', now(), now())
  ON CONFLICT (tenant_id) DO NOTHING;
  SELECT * INTO eski FROM tenant_abonelikleri WHERE tenant_id = p_tenant FOR UPDATE;
  yeni_plan := COALESCE(p_plan, eski.plan_kodu);
  yeni_durum := COALESCE(p_durum, eski.durum::text)::"AbonelikDurumu";
  UPDATE tenant_abonelikleri SET
    plan_kodu = yeni_plan,
    durum = yeni_durum,
    donem_baslangici = CASE WHEN p_plan IS NOT NULL THEN now() ELSE donem_baslangici END,
    donem_sonu = CASE WHEN p_plan IS NOT NULL THEN now() + interval '1 month' ELSE donem_sonu END,
    iptal_tarihi = CASE WHEN yeni_durum = 'aktif' THEN NULL ELSE iptal_tarihi END,
    updated_at = now()
  WHERE tenant_id = p_tenant;
  INSERT INTO abonelik_degisiklikleri (id, tenant_id, onceki_plan, yeni_plan, onceki_durum, yeni_durum, neden, created_at)
  VALUES (gen_random_uuid(), p_tenant, eski.plan_kodu, yeni_plan, eski.durum, yeni_durum, p_neden, now());
END;
$$;

-- Talep kararı: yalnız bekleyen talep; onayda plan değişir.
CREATE FUNCTION platform_abonelik_talebi_karar(p_talep uuid, p_onay boolean, p_not text, p_platform uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE
  r abonelik_talepleri%ROWTYPE;
BEGIN
  SELECT * INTO r FROM abonelik_talepleri WHERE id = p_talep FOR UPDATE;
  IF NOT FOUND OR r.durum <> 'bekliyor' THEN
    RAISE EXCEPTION 'talep_bekliyor_degil' USING ERRCODE = 'P0002';
  END IF;
  UPDATE abonelik_talepleri SET durum = CASE WHEN p_onay THEN 'onaylandi' ELSE 'reddedildi' END,
    karar_notu = p_not, karar_veren_platform_id = p_platform, karar_at = now()
  WHERE id = p_talep;
  IF p_onay THEN
    PERFORM platform_abonelik_guncelle(r.tenant_id, r.istenen_plan, 'aktif', 'Plan talebi onaylandı' || COALESCE(': ' || p_not, ''));
  END IF;
  RETURN r.tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION platform_firma_ozeti() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_firma_abonelik_gecmisi(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_abonelik_guncelle(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_abonelik_talebi_karar(uuid, boolean, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_firma_ozeti() TO tekir_platform;
GRANT EXECUTE ON FUNCTION platform_firma_abonelik_gecmisi(uuid) TO tekir_platform;
GRANT EXECUTE ON FUNCTION platform_abonelik_guncelle(uuid, text, text, text) TO tekir_platform;
GRANT EXECUTE ON FUNCTION platform_abonelik_talebi_karar(uuid, boolean, text, uuid) TO tekir_platform;
