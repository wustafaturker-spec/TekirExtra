-- EBLG-101: firmaya özel entegratör tasarımı (EMSA düzeni) için firma ve banka hesabı alanları.
ALTER TABLE "tenants" ADD COLUMN "belge_marka_adi" TEXT;
ALTER TABLE "tenants" ADD COLUMN "belge_marka_alt" TEXT;
ALTER TABLE "tenants" ADD COLUMN "belge_ek_bilgi" TEXT;
ALTER TABLE "tenants" ADD COLUMN "belge_rozetleri" JSONB;

ALTER TABLE "banka_hesaplari" ADD COLUMN "swift" TEXT;
ALTER TABLE "banka_hesaplari" ADD COLUMN "faturada_goster" BOOLEAN NOT NULL DEFAULT false;
