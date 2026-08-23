ALTER TABLE "personel" ADD COLUMN "brut_maas" DECIMAL(15,2);
ALTER TABLE "personel_bordro" ADD COLUMN "mevzuat_seti_id" UUID, ADD COLUMN "hesap_ozeti" JSONB, ADD COLUMN "kumulatif_matrah" DECIMAL(15,2), ADD COLUMN "asgari_kumulatif_matrah" DECIMAL(15,2);
ALTER TABLE "personel_bordro" ADD CONSTRAINT "personel_bordro_mevzuat_seti_id_fkey" FOREIGN KEY ("mevzuat_seti_id") REFERENCES "bordro_mevzuat_setleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "personel_bordro_tenant_id_personel_id_donem_yil_donem_ay_idx" ON "personel_bordro"("tenant_id","personel_id","donem_yil","donem_ay");
