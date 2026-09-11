-- e-Arşiv gönderim şekli (EBLG-26): GİB, e-Arşiv faturanın alıcıya elektronik
-- mi kâğıt mı teslim edildiğini ister. Varsayılan cari kartında durur, fatura
-- oluşturulurken kopyalanır ve e-Belge sihirbazında değiştirilebilir. Mevcut
-- kayıtlar elektronik kalır; bugüne kadar gönderilen her e-Arşiv öyle gitti.
CREATE TYPE "EarsivGonderimSekli" AS ENUM ('elektronik', 'kagit');

ALTER TABLE "cari_hesaplar"
  ADD COLUMN "earsiv_gonderim_sekli" "EarsivGonderimSekli" NOT NULL DEFAULT 'elektronik';

ALTER TABLE "faturalar"
  ADD COLUMN "earsiv_gonderim_sekli" "EarsivGonderimSekli" NOT NULL DEFAULT 'elektronik';
