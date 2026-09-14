-- Giden e-İrsaliye durumunun otomatik sorgusu (EBLG-36).
--
-- Alıcı irsaliyenin bir kısmını kabul edebilir; yanıt satırlarında hem teslim
-- alınan hem reddedilen miktar olduğunda durum `kismi_kabul` olur.
-- `son_durum_sorgu_at` aynı irsaliyenin 2 saat dolmadan yeniden sorgulanmasını
-- engeller (faturadaki EBLG-14 kalıbı).

ALTER TYPE "EirsaliyeDurum" ADD VALUE IF NOT EXISTS 'kismi_kabul';

ALTER TABLE "eirsaliye_kayitlari" ADD COLUMN "son_durum_sorgu_at" TIMESTAMP(3);

DROP INDEX IF EXISTS "eirsaliye_kayitlari_tenant_id_durum_idx";
CREATE INDEX "eirsaliye_kayitlari_tenant_id_durum_son_durum_sorgu_at_idx" ON "eirsaliye_kayitlari"("tenant_id", "durum", "son_durum_sorgu_at");
