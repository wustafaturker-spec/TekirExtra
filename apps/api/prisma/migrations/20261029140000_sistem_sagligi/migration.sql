-- PLT-16…19: sistem sağlığı. Bu tablolar kiracı verisi taşımaz (iş adı,
-- süre, hata metni, süreç belleği); uygulama rolü yazar, platform rolü okur.

-- PLT-16: zamanlayıcı/iş başına son durum.
CREATE TABLE sistem_isleri (
  is_adi VARCHAR(80) PRIMARY KEY,
  son_baslangic TIMESTAMP(3),
  son_bitis TIMESTAMP(3),
  son_sure_ms INTEGER,
  son_basari_at TIMESTAMP(3),
  son_hata VARCHAR(1000),
  son_hata_at TIMESTAMP(3),
  ardisik_hata INTEGER NOT NULL DEFAULT 0,
  calisma_sayisi BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- PLT-16: her süreç açılışı bir satır; nabız 5 dakikada bir tazelenir.
CREATE TABLE sistem_surecleri (
  id UUID PRIMARY KEY,
  tur VARCHAR(20) NOT NULL CHECK (tur IN ('api', 'worker')),
  makine VARCHAR(120),
  pid INTEGER,
  basladi_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  son_nabiz_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rss_mb INTEGER,
  heap_mb INTEGER,
  heap_sinir_mb INTEGER
);
CREATE INDEX sistem_surecleri_tur_basladi_idx ON sistem_surecleri (tur, basladi_at DESC);

-- PLT-19: alarm başına açık/kapalı durum; e-posta tekilliği buradan.
CREATE TABLE sistem_alarmlari (
  anahtar VARCHAR(160) PRIMARY KEY,
  tur VARCHAR(40) NOT NULL,
  acik BOOLEAN NOT NULL DEFAULT true,
  ozet VARCHAR(1000) NOT NULL,
  ilk_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  son_gorulme_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  son_bildirim_at TIMESTAMP(3),
  kapandi_at TIMESTAMP(3)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON sistem_isleri, sistem_surecleri, sistem_alarmlari TO tekir_app;
GRANT SELECT ON sistem_isleri, sistem_surecleri, sistem_alarmlari TO tekir_platform;

-- PLT-17/19: aktif e-belge bağlantısı olan firmaların gelen tarama kursörü
-- (yalnız tarih; belge içeriği yok).
CREATE FUNCTION platform_gelen_kursor_durumu()
RETURNS TABLE (tenant_id uuid, unvan text, saglayici text, son_cekim_at timestamp, irsaliye_son_cekim_at timestamp)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT t.id, t.unvan, b.saglayici, k.son_cekim_at, k.irsaliye_son_cekim_at
  FROM baglantilar b
  JOIN tenants t ON t.id = b.tenant_id
  LEFT JOIN ebelge_gelen_kursor k ON k.tenant_id = b.tenant_id
  LEFT JOIN tenant_abonelikleri a ON a.tenant_id = b.tenant_id
  WHERE b.aile = 'ebelge' AND b.durum = 'aktif' AND COALESCE(a.durum::text, 'aktif') IN ('aktif', 'deneme');
$$;

-- PLT-17: hatalı ya da art arda hata veren bağlantılar (ayar içeriği dönmez).
CREATE FUNCTION platform_baglanti_sagligi()
RETURNS TABLE (tenant_id uuid, unvan text, aile text, saglayici text, durum text, son_senkron_tarihi timestamp, son_senkron_hatasi text, ardisik_hata integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT t.id, t.unvan, b.aile::text, b.saglayici, b.durum::text, b.son_senkron_tarihi, left(b.son_senkron_hatasi, 500), b.ardisik_hata
  FROM baglantilar b JOIN tenants t ON t.id = b.tenant_id
  WHERE b.durum::text = 'hata' OR b.ardisik_hata > 0
  ORDER BY b.ardisik_hata DESC, t.unvan;
$$;

REVOKE ALL ON FUNCTION platform_gelen_kursor_durumu() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_baglanti_sagligi() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_gelen_kursor_durumu() TO tekir_platform;
GRANT EXECUTE ON FUNCTION platform_baglanti_sagligi() TO tekir_platform;

-- PLT-17: kuyruk satırlarına firma adı (yalnız unvan).
CREATE FUNCTION platform_firma_adlari(p_idler uuid[])
RETURNS TABLE (tenant_id uuid, unvan text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT t.id, t.unvan FROM tenants t WHERE t.id = ANY(p_idler);
$$;
REVOKE ALL ON FUNCTION platform_firma_adlari(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_firma_adlari(uuid[]) TO tekir_platform;
