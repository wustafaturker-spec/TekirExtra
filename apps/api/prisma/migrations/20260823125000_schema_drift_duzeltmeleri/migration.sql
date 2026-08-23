-- Yeni personel ve uretim migration'larini Prisma semasiyla hizalar.

-- DropIndex
DROP INDEX "personel_bordro_tenant_id_personel_id_donem_yil_donem_ay_idx";

-- DropIndex
DROP INDEX "personel_bordro_kalemleri_avans_id_idx";

-- AlterTable
ALTER TABLE "is_merkezleri" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "recete_operasyonlari" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "uretim_bildirimi_sarflari" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "uretim_bildirimleri" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "uretim_emri_operasyonlari" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "uretim_kalite_kontrolleri" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "uretim_malzeme_rezervasyonlari" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "uretim_sarf_duzeltmeleri" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "urun_receteleri" ALTER COLUMN "durum" SET DEFAULT 'taslak';

-- RenameIndex
ALTER INDEX "personel_istihdam_donemleri_tenant_id_personel_id_baslangic_tar" RENAME TO "personel_istihdam_donemleri_tenant_id_personel_id_baslangic_idx";

-- RenameIndex
ALTER INDEX "personel_izin_bakiye_hareketleri_tenant_id_personel_id_izin_tur" RENAME TO "personel_izin_bakiye_hareketleri_tenant_id_personel_id_izin_idx";

-- RenameIndex
ALTER INDEX "personel_izin_talepleri_tenant_id_personel_id_baslangic_tarihi_" RENAME TO "personel_izin_talepleri_tenant_id_personel_id_baslangic_tar_idx";

-- RenameIndex
ALTER INDEX "uretim_bildirimi_sarflari_uretim_bildirimi_id_uretim_emri_kalem" RENAME TO "uretim_bildirimi_sarflari_uretim_bildirimi_id_uretim_emri_k_key";

-- RenameIndex
ALTER INDEX "uretim_bildirimleri_tenant_id_uretim_emri_id_bildirim_tarihi_id" RENAME TO "uretim_bildirimleri_tenant_id_uretim_emri_id_bildirim_tarih_idx";

-- RenameIndex
ALTER INDEX "uretim_emri_operasyonlari_tenant_id_is_merkezi_id_planlanan_bas" RENAME TO "uretim_emri_operasyonlari_tenant_id_is_merkezi_id_planlanan_idx";

-- RenameIndex
ALTER INDEX "uretim_malzeme_rezervasyonlari_tenant_id_uretim_emri_kalem_id_d" RENAME TO "uretim_malzeme_rezervasyonlari_tenant_id_uretim_emri_kalem__key";

-- RenameIndex
ALTER INDEX "uretim_sarf_duzeltmeleri_tenant_id_uretim_emri_id_created_at_id" RENAME TO "uretim_sarf_duzeltmeleri_tenant_id_uretim_emri_id_created_a_idx";
