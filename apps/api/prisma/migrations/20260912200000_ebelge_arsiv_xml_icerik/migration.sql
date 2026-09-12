-- Sütun ilk göçte "xml_icirik" olarak yazılmış (20260712155955_fatura_modulu);
-- alan adı `xmlIcerik` olduğu için eşleme bu yazım hatasını taşıyordu. Ham SQL
-- yazan herkesin tökezlediği yer burasıydı.
--
-- Sütuna bağlı indeks, kısıt ya da RLS politikası yok (tenant_isolation yalnız
-- tenant_id'ye bakar), bu yüzden yeniden adlandırma tek adımda güvenlidir.
-- Dikkat: eski sürüm kod bu göçten sonra bu tabloyu okuyamaz; göç ile dağıtım
-- aynı anda yapılmalıdır.
ALTER TABLE "ebelge_arsiv" RENAME COLUMN "xml_icirik" TO "xml_icerik";
