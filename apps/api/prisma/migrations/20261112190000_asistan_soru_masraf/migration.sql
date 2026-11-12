-- CNL-16: Telegram'dan gelen fiş/fatura görselinin masraf kategorisi belirsizse asistan sorar.
ALTER TABLE "asistan_sorulari" DROP CONSTRAINT "asistan_sorulari_tur_check";
ALTER TABLE "asistan_sorulari" ADD CONSTRAINT "asistan_sorulari_tur_check" CHECK ("tur" IN ('banka_satiri', 'eposta_gonderen', 'taslak_kosul', 'masraf_kategori'));
