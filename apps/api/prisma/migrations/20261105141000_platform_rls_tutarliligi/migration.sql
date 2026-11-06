BEGIN;
-- Mevcut ayrıcalıklar korunur: paket planı bağlantısını yalnız platform okur.
ALTER TABLE platform_paket_atama_firmalari ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_paket_atama_firmalari FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_okuma ON platform_paket_atama_firmalari FOR SELECT TO tekir_platform USING (true);
-- Rezervasyonlar yalnız dar SECURITY DEFINER işlevlerinden kullanılır; doğrudan erişim kapalı kalır.
CREATE POLICY dogrudan_erisim_kapali ON ek_yukleme_rezervasyonlari USING (false) WITH CHECK (false);
COMMIT;
