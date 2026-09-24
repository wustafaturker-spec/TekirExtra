-- EBLG-83: giden e-İrsaliye numarası onayda değil gönderimde verilir; kâğıt
-- irsaliye (firma ya da alıcı e-İrsaliye kullanıcısı değil) giden seriden
-- numara almaz, kendi serisinden (KIR) numaralanır ve matbu numarası ayrı
-- alanda tutulur.
ALTER TABLE "belgeler" ADD COLUMN "kagit_irsaliye" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "belgeler" ADD COLUMN "matbu_belge_no" TEXT;

ALTER TABLE "belge_sayaclari" ADD COLUMN "seri" TEXT NOT NULL DEFAULT '';
DROP INDEX "belge_sayaclari_tenant_id_tur_yon_yil_key";
CREATE UNIQUE INDEX "belge_sayaclari_tenant_id_tur_yon_seri_yil_key" ON "belge_sayaclari"("tenant_id", "tur", "yon", "seri", "yil");
