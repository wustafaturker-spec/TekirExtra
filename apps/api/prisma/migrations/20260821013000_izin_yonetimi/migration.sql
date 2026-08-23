CREATE TYPE "PersonelIzinTalepDurum" AS ENUM ('talep', 'onaylandi', 'reddedildi', 'iptal');
CREATE TYPE "PersonelIzinBakiyeHareketTipi" AS ENUM ('devir', 'hak_edis', 'kullanim', 'iade', 'duzeltme_artis', 'duzeltme_azalis');
CREATE TABLE "personel_izin_turleri" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "kod" TEXT NOT NULL, "ad" TEXT NOT NULL,
  "ucretli" BOOLEAN NOT NULL DEFAULT true, "bakiye_takibi" BOOLEAN NOT NULL DEFAULT true,
  "aktif" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personel_izin_turleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personel_izin_turleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "personel_izin_turleri_tenant_id_kod_key" ON "personel_izin_turleri"("tenant_id", "kod");
CREATE INDEX "personel_izin_turleri_tenant_id_aktif_ad_idx" ON "personel_izin_turleri"("tenant_id", "aktif", "ad");
CREATE TABLE "personel_izin_talepleri" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "personel_id" UUID NOT NULL, "izin_turu_id" UUID NOT NULL,
  "baslangic_tarihi" DATE NOT NULL, "bitis_tarihi" DATE NOT NULL, "gun_sayisi" DECIMAL(6,2) NOT NULL,
  "aciklama" TEXT, "durum" "PersonelIzinTalepDurum" NOT NULL DEFAULT 'talep',
  "olusturan_user_id" UUID NOT NULL, "onaylayan_user_id" UUID, "karar_tarihi" TIMESTAMP(3), "karar_nedeni" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personel_izin_talepleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personel_izin_talepleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personel_izin_talepleri_personel_id_fkey" FOREIGN KEY ("personel_id") REFERENCES "personel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personel_izin_talepleri_izin_turu_id_fkey" FOREIGN KEY ("izin_turu_id") REFERENCES "personel_izin_turleri"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "personel_izin_tarih_check" CHECK ("bitis_tarihi" >= "baslangic_tarihi"),
  CONSTRAINT "personel_izin_gun_check" CHECK ("gun_sayisi" > 0)
);
CREATE INDEX "personel_izin_talepleri_tenant_id_personel_id_baslangic_tarihi_bitis_tarihi_idx" ON "personel_izin_talepleri"("tenant_id", "personel_id", "baslangic_tarihi", "bitis_tarihi");
CREATE INDEX "personel_izin_talepleri_tenant_id_durum_idx" ON "personel_izin_talepleri"("tenant_id", "durum");
CREATE TABLE "personel_izin_bakiye_hareketleri" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "personel_id" UUID NOT NULL, "izin_turu_id" UUID NOT NULL,
  "izin_talebi_id" UUID, "tip" "PersonelIzinBakiyeHareketTipi" NOT NULL, "gun" DECIMAL(6,2) NOT NULL,
  "aciklama" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personel_izin_bakiye_hareketleri_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personel_izin_bakiye_hareketleri_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personel_izin_bakiye_hareketleri_personel_id_fkey" FOREIGN KEY ("personel_id") REFERENCES "personel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "personel_izin_bakiye_hareketleri_izin_turu_id_fkey" FOREIGN KEY ("izin_turu_id") REFERENCES "personel_izin_turleri"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "personel_izin_bakiye_hareketleri_izin_talebi_id_fkey" FOREIGN KEY ("izin_talebi_id") REFERENCES "personel_izin_talepleri"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "personel_izin_bakiye_gun_check" CHECK ("gun" > 0)
);
CREATE INDEX "personel_izin_bakiye_hareketleri_tenant_id_personel_id_izin_turu_id_created_at_idx" ON "personel_izin_bakiye_hareketleri"("tenant_id", "personel_id", "izin_turu_id", "created_at");
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['personel_izin_turleri','personel_izin_talepleri','personel_izin_bakiye_hareketleri'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t); EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t); END LOOP; END $$;
