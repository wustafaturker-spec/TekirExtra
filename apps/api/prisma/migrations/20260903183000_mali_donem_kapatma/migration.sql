CREATE TYPE "MaliDonemDurumu" AS ENUM ('acik', 'kapali');
CREATE TYPE "MaliDonemOlayTuru" AS ENUM ('kapatildi', 'yeniden_acildi');

CREATE TABLE "mali_donemler" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "yil" INTEGER NOT NULL, "ay" INTEGER NOT NULL,
  "durum" "MaliDonemDurumu" NOT NULL DEFAULT 'acik', "kapatildi_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mali_donemler_pkey" PRIMARY KEY ("id"), CONSTRAINT "mali_donemler_ay_check" CHECK ("ay" BETWEEN 1 AND 12)
);
CREATE TABLE "donem_kontrolleri" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "mali_donem_id" UUID NOT NULL, "kod" TEXT NOT NULL,
  "basarili" BOOLEAN NOT NULL, "aciklama" TEXT NOT NULL, "detay" JSONB, "kontrol_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "donem_kontrolleri_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "mali_donem_olaylari" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "mali_donem_id" UUID NOT NULL,
  "tur" "MaliDonemOlayTuru" NOT NULL, "gerekce" TEXT NOT NULL, "user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "mali_donem_olaylari_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mali_donemler_tenant_id_yil_ay_key" ON "mali_donemler"("tenant_id", "yil", "ay");
CREATE INDEX "mali_donemler_tenant_id_durum_yil_ay_idx" ON "mali_donemler"("tenant_id", "durum", "yil", "ay");
CREATE UNIQUE INDEX "donem_kontrolleri_mali_donem_id_kod_key" ON "donem_kontrolleri"("mali_donem_id", "kod");
CREATE INDEX "donem_kontrolleri_tenant_id_mali_donem_id_idx" ON "donem_kontrolleri"("tenant_id", "mali_donem_id");
CREATE INDEX "mali_donem_olaylari_tenant_id_mali_donem_id_created_at_idx" ON "mali_donem_olaylari"("tenant_id", "mali_donem_id", "created_at");
ALTER TABLE "mali_donemler" ADD CONSTRAINT "mali_donemler_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "donem_kontrolleri" ADD CONSTRAINT "donem_kontrolleri_mali_donem_id_fkey" FOREIGN KEY ("mali_donem_id") REFERENCES "mali_donemler"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "donem_kontrolleri" ADD CONSTRAINT "donem_kontrolleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mali_donem_olaylari" ADD CONSTRAINT "mali_donem_olaylari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mali_donem_olaylari" ADD CONSTRAINT "mali_donem_olaylari_mali_donem_id_fkey" FOREIGN KEY ("mali_donem_id") REFERENCES "mali_donemler"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mali_donem_olaylari" ADD CONSTRAINT "mali_donem_olaylari_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mali_donemler" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mali_donemler" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_mali_donemler" ON "mali_donemler" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "donem_kontrolleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "donem_kontrolleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_donem_kontrolleri" ON "donem_kontrolleri" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "mali_donem_olaylari" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mali_donem_olaylari" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_mali_donem_olaylari" ON "mali_donem_olaylari" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Uygulama servislerini atlayan worker/webhook yolları için son savunma katmanı.
CREATE FUNCTION mali_donem_yazma_kilidi() RETURNS trigger AS $$
DECLARE kayit RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN kayit := OLD; ELSE kayit := NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM mali_donemler
    WHERE tenant_id = kayit.tenant_id
      AND yil = EXTRACT(YEAR FROM kayit.tarih)::int
      AND ay = EXTRACT(MONTH FROM kayit.tarih)::int
      AND durum = 'kapali'
  ) THEN
    RAISE EXCEPTION 'Mali dönem kapalı: %', kayit.tarih USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "faturalar_mali_donem_kilidi" BEFORE INSERT OR UPDATE OR DELETE ON "faturalar" FOR EACH ROW EXECUTE FUNCTION mali_donem_yazma_kilidi();
CREATE TRIGGER "belgeler_mali_donem_kilidi" BEFORE INSERT OR UPDATE OR DELETE ON "belgeler" FOR EACH ROW EXECUTE FUNCTION mali_donem_yazma_kilidi();
CREATE TRIGGER "cari_hareketler_mali_donem_kilidi" BEFORE INSERT OR UPDATE OR DELETE ON "cari_hareketler" FOR EACH ROW EXECUTE FUNCTION mali_donem_yazma_kilidi();
CREATE TRIGGER "kasa_banka_hareketleri_mali_donem_kilidi" BEFORE INSERT OR UPDATE OR DELETE ON "kasa_banka_hareketleri" FOR EACH ROW EXECUTE FUNCTION mali_donem_yazma_kilidi();
CREATE TRIGGER "stok_hareketleri_mali_donem_kilidi" BEFORE INSERT OR UPDATE OR DELETE ON "stok_hareketleri" FOR EACH ROW EXECUTE FUNCTION mali_donem_yazma_kilidi();
CREATE TRIGGER "kredi_karti_hareketleri_mali_donem_kilidi" BEFORE INSERT OR UPDATE OR DELETE ON "kredi_karti_hareketleri" FOR EACH ROW EXECUTE FUNCTION mali_donem_yazma_kilidi();
CREATE TRIGGER "masraflar_mali_donem_kilidi" BEFORE INSERT OR UPDATE OR DELETE ON "masraflar" FOR EACH ROW EXECUTE FUNCTION mali_donem_yazma_kilidi();
