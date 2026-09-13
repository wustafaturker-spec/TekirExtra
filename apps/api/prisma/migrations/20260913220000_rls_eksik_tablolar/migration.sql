-- Kiracı yalıtımı eksik tablolar (MIMARI §3).
--
-- 2026-09-13 denetimi: kiracıya ait 17 tabloda RLS yoktu. Uygulama rolü
-- (BYPASSRLS'siz) başka kiracının satırlarını okuyabiliyordu.
--   * 20260827213000_gelir_proje_analitik yarıda hata verip adımları
--     çalışmadan "uygulandı" işaretlendi; dosyanın sonundaki RLS satırları hiç
--     çalışmadı (projeler, proje_*, gelir_*).
--   * Kredi kartı, üretim/reçete, masraf ödemesi, çek-senet olayı, CRM fırsatı
--     ve dövizli stok fiyatı tablolarının geçişlerinde RLS hiç yazılmamıştı.
-- Ayrıca RLS'si olup FORCE'u eksik 4 tabloya FORCE eklenir; tablo sahibi rol
-- de politikaya tabi olur.
--
-- Politikalar önce silinip yeniden kurulur: yarım kalan geçişin tam çalıştığı
-- ortamlarda proje ve gelir politikaları zaten vardır.
--
-- Bilinçli istisna: auth_kimlikler, oturumlar, eposta_dogrulamalar. Giriş,
-- oturum yenileme ve e-posta doğrulama kiracı bağlamı kurulmadan çalışır;
-- bu tablolar kiracı API'sine açık değildir.

DO $$
DECLARE
  tablo text;
BEGIN
  FOREACH tablo IN ARRAY ARRAY[
    'projeler',
    'proje_asamalari',
    'proje_alt_kirilimlari',
    'proje_notlari',
    'gelir_kategorileri',
    'gelir_kayitlari',
    'kredi_kartlari',
    'kredi_karti_hareketleri',
    'kredi_karti_taksitleri',
    'uretim_emirleri',
    'uretim_emri_kalemleri',
    'urun_receteleri',
    'urun_recetesi_kalemleri',
    'masraf_odemeleri',
    'cek_senet_olaylari',
    'crm_firsatlari',
    'stok_fiyatlari'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tablo);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tablo);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'tenant_isolation_' || tablo, tablo);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("tenant_id" = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK ("tenant_id" = current_setting(''app.tenant_id'', true)::uuid)',
      'tenant_isolation_' || tablo,
      tablo
    );
  END LOOP;

  FOREACH tablo IN ARRAY ARRAY[
    'masraflar',
    'masraf_kategorileri',
    'kira_sozlesmeleri',
    'eposta_gonderimleri'
  ] LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tablo);
  END LOOP;
END $$;
