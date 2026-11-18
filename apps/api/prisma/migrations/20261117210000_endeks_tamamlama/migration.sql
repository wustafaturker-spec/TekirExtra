-- END-08/10/26: satış kuru, gözlenen seri kullanımı ve birim tarihçesi.
-- Mevcut özel rollerin fiili erişimi korunur; sonra iki kutu bağımsız yönetilir.
UPDATE ozel_roller r SET kapali_kutular = ARRAY(
 SELECT DISTINCT k FROM unnest(r.kapali_kutular ||
   CASE WHEN r.sablon_rol::text = 'yonetici' OR COALESCE((SELECT a.ayarlar->'satisRolleri' FROM modul_ayarlari a WHERE a.tenant_id=r.tenant_id AND a.modul='fiyat_endeks'), '["muhasebe"]'::jsonb) ? r.sablon_rol::text
     THEN ARRAY[]::text[] ELSE ARRAY['fiyat_endeks_satis.goruntule'] END ||
   CASE WHEN r.sablon_rol::text = 'yonetici' OR COALESCE((SELECT a.ayarlar->'alisRolleri' FROM modul_ayarlari a WHERE a.tenant_id=r.tenant_id AND a.modul='fiyat_endeks'), '["muhasebe"]'::jsonb) ? r.sablon_rol::text
     THEN ARRAY[]::text[] ELSE ARRAY['fiyat_endeks_alis.goruntule'] END
 ) k ORDER BY k
);
INSERT INTO endeks_serileri (kod, evds_kodu, ad, kaynak, sira, kaynak_siklik, tur, updated_at) VALUES
 ('USD_SATIS', 'TP.DK.USD.S.YTL', 'ABD doları (TCMB döviz satış, aylık ortalama)', 'TCMB', 31, 'gunluk', 'kur', CURRENT_TIMESTAMP),
 ('EUR_SATIS', 'TP.DK.EUR.S.YTL', 'Euro (TCMB döviz satış, aylık ortalama)', 'TCMB', 41, 'gunluk', 'kur', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

CREATE TABLE endeks_kullanimlari (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 seri_kodu varchar(40) NOT NULL REFERENCES endeks_serileri(kod) ON DELETE CASCADE,
 ilk_kullanim_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 son_kullanim_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (tenant_id, seri_kodu)
);
ALTER TABLE endeks_kullanimlari ENABLE ROW LEVEL SECURITY;
ALTER TABLE endeks_kullanimlari FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_endeks_kullanimlari ON endeks_kullanimlari
 USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
 WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
REVOKE ALL ON endeks_kullanimlari FROM PUBLIC, tekir_app, tekir_platform;
GRANT SELECT, INSERT, UPDATE ON endeks_kullanimlari TO tekir_app;
-- Platform yalnız anonim toplamları okuyabilir, kiracı kimliklerini okuyamaz.
CREATE FUNCTION platform_endeks_kullanim_sayilari()
 RETURNS TABLE (seri_kodu varchar(40), kiraci_sayisi bigint)
 LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT k.seri_kodu, count(*) FROM public.endeks_kullanimlari k GROUP BY k.seri_kodu
$$;
REVOKE ALL ON FUNCTION platform_endeks_kullanim_sayilari() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_endeks_kullanim_sayilari() TO tekir_platform;

CREATE TABLE stok_birim_gecmisi (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 stok_id uuid NOT NULL REFERENCES stok_kartlari(id) ON DELETE CASCADE,
 birim text NOT NULL,
 eski_birim text, yeni_birim text,
 eski_katsayi numeric(15,6), yeni_katsayi numeric(15,6),
 degisti_at timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);
CREATE INDEX stok_birim_gecmisi_stok_zaman ON stok_birim_gecmisi(tenant_id, stok_id, degisti_at);
ALTER TABLE stok_birim_gecmisi ENABLE ROW LEVEL SECURITY;
ALTER TABLE stok_birim_gecmisi FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_stok_birim_gecmisi ON stok_birim_gecmisi
 USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
 WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE TRIGGER kbag_stok_birim_gecmisi_stok_id AFTER INSERT OR UPDATE OF stok_id, tenant_id ON stok_birim_gecmisi
 FOR EACH ROW EXECUTE FUNCTION kiraci_bag_denetle('stok_id', 'stok_kartlari', 'id');
REVOKE ALL ON stok_birim_gecmisi FROM PUBLIC, tekir_app, tekir_platform;
GRANT SELECT, INSERT ON stok_birim_gecmisi TO tekir_app;

CREATE FUNCTION stok_birim_tarihcesi_yaz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME = 'stok_kartlari' THEN
   IF NEW.ana_birim IS DISTINCT FROM OLD.ana_birim THEN
     INSERT INTO stok_birim_gecmisi (tenant_id, stok_id, birim, eski_birim, yeni_birim, eski_katsayi, yeni_katsayi)
     VALUES (NEW.tenant_id, NEW.id, NEW.ana_birim, OLD.ana_birim, NEW.ana_birim, 1, 1);
   END IF;
 ELSIF TG_OP = 'DELETE' THEN
   INSERT INTO stok_birim_gecmisi (tenant_id, stok_id, birim, eski_birim, eski_katsayi)
   VALUES (OLD.tenant_id, OLD.stok_id, OLD.ad, OLD.ad, OLD.katsayi);
 ELSIF TG_OP = 'UPDATE' AND (NEW.ad, NEW.katsayi) IS DISTINCT FROM (OLD.ad, OLD.katsayi) THEN
   INSERT INTO stok_birim_gecmisi (tenant_id, stok_id, birim, eski_birim, yeni_birim, eski_katsayi, yeni_katsayi)
   VALUES (NEW.tenant_id, NEW.stok_id, NEW.ad, OLD.ad, NEW.ad, OLD.katsayi, NEW.katsayi);
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER stok_ana_birim_tarihcesi AFTER UPDATE OF ana_birim ON stok_kartlari
 FOR EACH ROW EXECUTE FUNCTION stok_birim_tarihcesi_yaz();
CREATE TRIGGER stok_ek_birim_tarihcesi AFTER UPDATE OF ad, katsayi OR DELETE ON stok_birimleri
 FOR EACH ROW EXECUTE FUNCTION stok_birim_tarihcesi_yaz();

-- Yeni satırda kullanılan katsayı saklanır. Eski satırlarda tarihçe uydurulmaz.
ALTER TABLE fatura_satirlari ADD COLUMN birim_katsayi numeric(15,6);
CREATE FUNCTION fatura_birim_katsayi_sakla() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'INSERT' OR (NEW.stok_id, NEW.birim) IS DISTINCT FROM (OLD.stok_id, OLD.birim) THEN
   SELECT CASE WHEN NEW.birim = s.ana_birim THEN 1::numeric ELSE
     (SELECT b.katsayi FROM stok_birimleri b WHERE b.stok_id = s.id AND b.tenant_id = NEW.tenant_id AND b.ad = NEW.birim LIMIT 1)
   END INTO NEW.birim_katsayi FROM stok_kartlari s WHERE s.id = NEW.stok_id AND s.tenant_id = NEW.tenant_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fatura_birim_katsayi_sakla BEFORE INSERT OR UPDATE OF stok_id, birim ON fatura_satirlari
 FOR EACH ROW EXECUTE FUNCTION fatura_birim_katsayi_sakla();
