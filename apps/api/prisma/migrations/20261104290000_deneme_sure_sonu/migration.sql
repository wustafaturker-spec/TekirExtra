-- Denemeden ücretli döneme geçiş; aynı ödeme ikinci kez süre eklemez.
CREATE OR REPLACE FUNCTION platform_odeme_kaydet(p_tenant uuid, p_ay integer, p_tutar numeric, p_not text, p_platform uuid, p_eposta text, p_anahtar text, p_ozet text)
RETURNS TABLE (yeni_donem_sonu timestamp, odeme_id uuid, tekrar boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
#variable_conflict use_column
DECLARE
  eski tenant_abonelikleri%ROWTYPE;
  mevcut abonelik_odemeleri%ROWTYPE;
  yeni_son timestamp(3);
  yeni_id uuid := gen_random_uuid();
BEGIN
  IF p_anahtar IS NULL OR length(p_anahtar) < 16 OR length(p_anahtar) > 100 THEN RAISE EXCEPTION 'islem_anahtari_yok' USING ERRCODE = 'P0001'; END IF;
  IF p_tutar < 0 OR p_tutar <> round(p_tutar, 2) THEN RAISE EXCEPTION 'gecersiz_tutar' USING ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('abonelik-odeme:' || p_anahtar, 0));
  SELECT * INTO mevcut FROM abonelik_odemeleri WHERE islem_anahtari = p_anahtar;
  IF FOUND THEN
    IF mevcut.istek_ozeti IS DISTINCT FROM p_ozet OR mevcut.tenant_id <> p_tenant THEN
      RAISE EXCEPTION 'islem_anahtari_cakisma' USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT mevcut.yeni_donem_sonu, mevcut.id, true;
    RETURN;
  END IF;
  IF p_ay NOT IN (1, 3, 6, 12) THEN RAISE EXCEPTION 'gecersiz_sure' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant) THEN
    RAISE EXCEPTION 'firma_yok' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO tenant_abonelikleri (id, tenant_id, plan_kodu, durum, created_at, updated_at)
  VALUES (gen_random_uuid(), p_tenant, 'v1', 'aktif', now(), now())
  ON CONFLICT (tenant_id) DO NOTHING;
  SELECT * INTO eski FROM tenant_abonelikleri WHERE tenant_id = p_tenant FOR UPDATE;
  yeni_son := (CASE WHEN eski.durum = 'deneme' THEN GREATEST(COALESCE(eski.donem_sonu, now()), now()) ELSE COALESCE(eski.donem_sonu, now()) END) + make_interval(months => p_ay);
  UPDATE tenant_abonelikleri SET
    donem_baslangici = CASE WHEN eski.durum = 'deneme' THEN GREATEST(COALESCE(eski.donem_sonu, now()), now()) ELSE COALESCE(donem_baslangici, now()) END,
    durum = CASE WHEN eski.durum = 'deneme' THEN 'aktif'::"AbonelikDurumu" ELSE durum END,
    donem_sonu = yeni_son,
    updated_at = now()
  WHERE tenant_id = p_tenant;
  INSERT INTO abonelik_odemeleri (id, tenant_id, ay_sayisi, tutar, "not", onceki_donem_sonu, yeni_donem_sonu, platform_kullanici_id, islem_anahtari, istek_ozeti, created_at)
  VALUES (yeni_id, p_tenant, p_ay, p_tutar, p_not, eski.donem_sonu, yeni_son, p_platform, p_anahtar, p_ozet, now());
  INSERT INTO abonelik_degisiklikleri (id, tenant_id, onceki_plan, yeni_plan, onceki_durum, yeni_durum, neden, created_at)
  VALUES (gen_random_uuid(), p_tenant, eski.plan_kodu, eski.plan_kodu, eski.durum, CASE WHEN eski.durum = 'deneme' THEN 'aktif'::"AbonelikDurumu" ELSE eski.durum END,
    format('Ödeme alındı (%s): %s ay, %s TL; dönem sonu %s', p_eposta, p_ay, replace(to_char(p_tutar, 'FM999999999990.00'), '.', ','), to_char(yeni_son, 'DD.MM.YYYY')) || COALESCE(' — ' || NULLIF(p_not, ''), ''),
    now());
  RETURN QUERY SELECT yeni_son, yeni_id, false;
END;
$$;

REVOKE ALL ON FUNCTION platform_odeme_kaydet(uuid, integer, numeric, text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_odeme_kaydet(uuid, integer, numeric, text, uuid, text, text, text) TO tekir_platform;
