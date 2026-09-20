-- Şarj faturaları (14.09.2026 şematronu §1) ve İDİS belgeleri (§2 + GİB İDİS
-- Teknik Kılavuzu v1.0).
--
-- Şarj türü stok kartından türer; plaka, şarj süresi ve ESU raporları faturada,
-- ünite seri numarası satırda durur. İDİS'te sevkiyat numarası belge başına,
-- etiket numarası satır başına zorunludur (fatura ve irsaliye).

ALTER TABLE "stok_kartlari"
  ADD COLUMN IF NOT EXISTS "sarj_turu" TEXT;

ALTER TABLE "faturalar"
  ADD COLUMN IF NOT EXISTS "sarj_plaka" TEXT,
  ADD COLUMN IF NOT EXISTS "sarj_baslangic" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sarj_bitis" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sarj_esu_raporlari" JSONB,
  ADD COLUMN IF NOT EXISTS "idis_sevkiyat_no" TEXT;

ALTER TABLE "fatura_satirlari"
  ADD COLUMN IF NOT EXISTS "idis_etiket_no" TEXT,
  ADD COLUMN IF NOT EXISTS "sarj_unite_seri_no" TEXT;

ALTER TABLE "belgeler"
  ADD COLUMN IF NOT EXISTS "idis_sevkiyat_no" TEXT;

ALTER TABLE "belge_satirlari"
  ADD COLUMN IF NOT EXISTS "idis_etiket_no" TEXT;
