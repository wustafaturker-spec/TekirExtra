-- ILT-04: öncelikli iletinin ömrü dolunca gönderilmez.
ALTER TABLE "platform_ileti_kayitlari" DROP CONSTRAINT "platform_ileti_kayitlari_durum_check";
ALTER TABLE "platform_ileti_kayitlari" ADD CONSTRAINT "platform_ileti_kayitlari_durum_check" CHECK ("durum" IN ('kuyrukta', 'gonderildi', 'basarisiz', 'belirsiz', 'suresi_doldu'));

-- ILT-14: varsayılan tavanlar (tek satır) ve firma istisnaları; boş alan varsayılanı kullanır.
CREATE TABLE "platform_ileti_limit" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "eposta_gunluk" INTEGER NOT NULL,
    "eposta_aylik" INTEGER NOT NULL,
    "sms_gunluk" INTEGER NOT NULL,
    "sms_aylik" INTEGER NOT NULL,
    "guncelleyen_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_ileti_limit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_ileti_limit_tek_satir" CHECK ("id" = 1)
);
CREATE TABLE "platform_ileti_firma_limitleri" (
    "tenant_id" UUID NOT NULL,
    "eposta_gunluk" INTEGER,
    "eposta_aylik" INTEGER,
    "sms_gunluk" INTEGER,
    "sms_aylik" INTEGER,
    "guncelleyen_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_ileti_firma_limitleri_pkey" PRIMARY KEY ("tenant_id")
);
GRANT SELECT, INSERT, UPDATE ON "platform_ileti_limit" TO tekir_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_ileti_firma_limitleri" TO tekir_platform;
REVOKE ALL ON "platform_ileti_limit" FROM tekir_app;
REVOKE ALL ON "platform_ileti_firma_limitleri" FROM tekir_app;

-- Firma adı kiracı tablosundan okunur; platform rolü yalnız istisna satırlarının adını görür.
CREATE FUNCTION platform_ileti_firma_limit_listesi()
RETURNS TABLE (tenant_id uuid, firma text, eposta_gunluk integer, eposta_aylik integer, sms_gunluk integer, sms_aylik integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET row_security = off AS $$
  SELECT l.tenant_id, t.unvan::text, l.eposta_gunluk, l.eposta_aylik, l.sms_gunluk, l.sms_aylik
  FROM platform_ileti_firma_limitleri l JOIN tenants t ON t.id = l.tenant_id
  ORDER BY t.unvan, l.tenant_id;
$$;
REVOKE ALL ON FUNCTION platform_ileti_firma_limit_listesi() FROM PUBLIC, tekir_app;
GRANT EXECUTE ON FUNCTION platform_ileti_firma_limit_listesi() TO tekir_platform;
