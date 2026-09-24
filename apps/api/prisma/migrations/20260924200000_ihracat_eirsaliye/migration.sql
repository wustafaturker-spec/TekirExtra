-- EBLG-84: irsaliyeye özel teslimat adresi (ihracatta gümrük kapısı).
ALTER TABLE "belgeler" ADD COLUMN "teslimat_adres" TEXT;
ALTER TABLE "belgeler" ADD COLUMN "teslimat_il" TEXT;
ALTER TABLE "belgeler" ADD COLUMN "teslimat_ilce" TEXT;
ALTER TABLE "belgeler" ADD COLUMN "teslimat_posta_kodu" TEXT;

-- EBLG-85: alıcı etiketi olmadan (GİB sanal alıcısına) giden e-İrsaliye.
ALTER TABLE "eirsaliye_kayitlari" ADD COLUMN "alici_kayitsiz" BOOLEAN NOT NULL DEFAULT false;
