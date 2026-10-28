-- KLN-24 / PLT-10: destek erişimi. Firma yöneticisi TekirExtra ekibine süreli
-- izin verir; platform yöneticisi izin süresince firmanın panelini salt okunur
-- görür. Platform rolü kiracı tablolarına yalnız aşağıdaki dar SECURITY DEFINER
-- işlevleriyle dokunur.

CREATE TABLE "destek_izinleri" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "veren_user_id" UUID NOT NULL,
    "sure_saat" INTEGER NOT NULL,
    "baslangic" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bitis" TIMESTAMP(3) NOT NULL,
    "geri_alan_user_id" UUID,
    "geri_alindi_at" TIMESTAMP(3),
    CONSTRAINT "destek_izinleri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "destek_izinleri_sure_check" CHECK ("sure_saat" IN (1, 24, 168))
);
CREATE INDEX "destek_izinleri_tenant_id_bitis_idx" ON "destek_izinleri"("tenant_id", "bitis");
ALTER TABLE "destek_izinleri" ADD CONSTRAINT "destek_izinleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "destek_izinleri" ADD CONSTRAINT "destek_izinleri_veren_user_id_fkey" FOREIGN KEY ("veren_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "destek_izinleri" ADD CONSTRAINT "destek_izinleri_geri_alan_user_id_fkey" FOREIGN KEY ("geri_alan_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "destek_oturumlari" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "izin_id" UUID NOT NULL,
    "platform_kullanici_id" UUID NOT NULL,
    "platform_kullanici_adi" TEXT NOT NULL,
    "platform_kullanici_eposta" TEXT NOT NULL,
    "acilis" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bitis" TIMESTAMP(3) NOT NULL,
    "kapanis" TIMESTAMP(3),
    "kapanis_nedeni" TEXT,
    CONSTRAINT "destek_oturumlari_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "destek_oturumlari_tenant_id_acilis_idx" ON "destek_oturumlari"("tenant_id", "acilis");
ALTER TABLE "destek_oturumlari" ADD CONSTRAINT "destek_oturumlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "destek_oturumlari" ADD CONSTRAINT "destek_oturumlari_izin_id_fkey" FOREIGN KEY ("izin_id") REFERENCES "destek_izinleri"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE destek_izinleri ENABLE ROW LEVEL SECURITY;
ALTER TABLE destek_izinleri FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON destek_izinleri USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE destek_oturumlari ENABLE ROW LEVEL SECURITY;
ALTER TABLE destek_oturumlari FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON destek_oturumlari USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);

-- Etkin izinler ve açık destek oturumları (Firmalar ekranı için; içerik yok).
CREATE FUNCTION platform_destek_durumu()
RETURNS TABLE (tenant_id uuid, izin_bitis timestamp, acik_oturum_id uuid, acik_oturum_bitis timestamp, acik_oturum_kisi text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT i.tenant_id, i.bitis, o.id, o.bitis, o.platform_kullanici_adi
  FROM destek_izinleri i
  LEFT JOIN LATERAL (
    SELECT * FROM destek_oturumlari o WHERE o.izin_id = i.id AND o.kapanis IS NULL AND o.bitis > now() ORDER BY o.acilis DESC LIMIT 1
  ) o ON true
  WHERE i.geri_alindi_at IS NULL AND i.bitis > now();
$$;

-- Destek oturumu açar: yalnız etkin izin varken; oturum en çok 30 dk ve izin
-- bitişini aşmaz. Açılış firmanın denetim izine destek kişisinin adıyla yazılır.
CREATE FUNCTION platform_destek_oturumu_ac(p_tenant uuid, p_platform uuid, p_ad text, p_eposta text)
RETURNS TABLE (oturum_id uuid, bitis timestamp)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE
  izin destek_izinleri%ROWTYPE;
  yeni uuid := gen_random_uuid();
  son timestamp;
BEGIN
  SELECT * INTO izin FROM destek_izinleri i
  WHERE i.tenant_id = p_tenant AND i.geri_alindi_at IS NULL AND i.bitis > now()
  ORDER BY i.bitis DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'izin_yok' USING ERRCODE = 'P0001'; END IF;
  son := least(now() + interval '30 minutes', izin.bitis);
  INSERT INTO destek_oturumlari (id, tenant_id, izin_id, platform_kullanici_id, platform_kullanici_adi, platform_kullanici_eposta, acilis, bitis)
  VALUES (yeni, p_tenant, izin.id, p_platform, p_ad, p_eposta, now(), son);
  INSERT INTO audit_log (id, tenant_id, user_id, islem, varlik, varlik_id, detay, created_at)
  VALUES (gen_random_uuid(), p_tenant, NULL, 'destek_oturumu_acildi', 'destek_oturumu', yeni::text,
    jsonb_build_object('destekKisi', p_ad, 'destekEposta', p_eposta, 'bitis', son), now());
  RETURN QUERY SELECT yeni, son;
END;
$$;

-- Platform tarafında kapatma; firmanın denetim izine yazılır.
CREATE FUNCTION platform_destek_oturumu_kapat(p_oturum uuid, p_neden text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE
  o destek_oturumlari%ROWTYPE;
BEGIN
  UPDATE destek_oturumlari SET kapanis = now(), kapanis_nedeni = p_neden
  WHERE id = p_oturum AND kapanis IS NULL RETURNING * INTO o;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO audit_log (id, tenant_id, user_id, islem, varlik, varlik_id, detay, created_at)
  VALUES (gen_random_uuid(), o.tenant_id, NULL, 'destek_oturumu_kapatildi', 'destek_oturumu', o.id::text,
    jsonb_build_object('destekKisi', o.platform_kullanici_adi, 'destekEposta', o.platform_kullanici_eposta, 'neden', p_neden), now());
  RETURN o.tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION platform_destek_durumu() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_destek_oturumu_ac(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_destek_oturumu_kapat(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_destek_durumu() TO tekir_platform;
GRANT EXECUTE ON FUNCTION platform_destek_oturumu_ac(uuid, uuid, text, text) TO tekir_platform;
GRANT EXECUTE ON FUNCTION platform_destek_oturumu_kapat(uuid, text) TO tekir_platform;
