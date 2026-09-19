-- Yolcu beraberi eşya (tax-free) faturası.
--
-- İşaret e-Belge sihirbazında konur; yolcunun kimlik ve ikamet bilgisi ile o
-- faturada kullanılan aracı kurum faturaya tek bir JSON olarak yazılır (boşsa
-- fatura yolcu beraberi değildir). Aracı kurumun varsayılanı firma kartında.

ALTER TABLE "faturalar"
  ADD COLUMN IF NOT EXISTS "yolcu_beraberi" JSONB;

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "araci_kurum_vkn" TEXT,
  ADD COLUMN IF NOT EXISTS "araci_kurum_etiket" TEXT,
  ADD COLUMN IF NOT EXISTS "araci_kurum_unvan" TEXT;
