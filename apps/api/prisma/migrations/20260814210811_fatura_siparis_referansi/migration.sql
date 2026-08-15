-- DropForeignKey
ALTER TABLE "banka_baglanti_hesaplari" DROP CONSTRAINT "banka_baglanti_hesaplari_baglanti_id_fkey";

-- DropForeignKey
ALTER TABLE "banka_baglanti_hesaplari" DROP CONSTRAINT "banka_baglanti_hesaplari_banka_hesap_id_fkey";

-- DropForeignKey
ALTER TABLE "banka_baglanti_hesaplari" DROP CONSTRAINT "banka_baglanti_hesaplari_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "banka_odeme_talimatlari" DROP CONSTRAINT "banka_odeme_talimatlari_banka_hesap_id_fkey";

-- DropForeignKey
ALTER TABLE "banka_odeme_talimatlari" DROP CONSTRAINT "banka_odeme_talimatlari_olusturan_user_id_fkey";

-- DropForeignKey
ALTER TABLE "banka_odeme_talimatlari" DROP CONSTRAINT "banka_odeme_talimatlari_onaylayan_user_id_fkey";

-- DropForeignKey
ALTER TABLE "banka_odeme_talimatlari" DROP CONSTRAINT "banka_odeme_talimatlari_tenant_id_fkey";

-- DropIndex
DROP INDEX "cek_senetler_tenant_id_cek_no_idx";

-- AlterTable
ALTER TABLE "cek_senetler" ALTER COLUMN "islem_tarihi" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "faturalar" ADD COLUMN     "siparis_no" TEXT,
ADD COLUMN     "siparis_tarihi" DATE;

-- AddForeignKey
ALTER TABLE "banka_odeme_talimatlari" ADD CONSTRAINT "banka_odeme_talimatlari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banka_odeme_talimatlari" ADD CONSTRAINT "banka_odeme_talimatlari_banka_hesap_id_fkey" FOREIGN KEY ("banka_hesap_id") REFERENCES "banka_hesaplari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banka_odeme_talimatlari" ADD CONSTRAINT "banka_odeme_talimatlari_olusturan_user_id_fkey" FOREIGN KEY ("olusturan_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banka_odeme_talimatlari" ADD CONSTRAINT "banka_odeme_talimatlari_onaylayan_user_id_fkey" FOREIGN KEY ("onaylayan_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banka_baglanti_hesaplari" ADD CONSTRAINT "banka_baglanti_hesaplari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banka_baglanti_hesaplari" ADD CONSTRAINT "banka_baglanti_hesaplari_baglanti_id_fkey" FOREIGN KEY ("baglanti_id") REFERENCES "baglantilar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banka_baglanti_hesaplari" ADD CONSTRAINT "banka_baglanti_hesaplari_banka_hesap_id_fkey" FOREIGN KEY ("banka_hesap_id") REFERENCES "banka_hesaplari"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "crm_gorevleri_tenant_id_atanan_user_id_durum_hatirlatma_tarihi_" RENAME TO "crm_gorevleri_tenant_id_atanan_user_id_durum_hatirlatma_tar_idx";

-- RenameIndex
ALTER INDEX "stok_partileri_tenant_id_stok_id_varyant_id_depo_id_skt_idx" RENAME TO "stok_partileri_tenant_id_stok_id_varyant_id_depo_id_son_kul_idx";
