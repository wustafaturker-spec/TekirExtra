-- Belgeye müşteri sipariş referansı (EBLG-74): e-İrsaliyede `OrderReference`
-- olarak gider. Boş bırakılırsa zincirdeki siparişin numarası ve tarihi yazılır.

ALTER TABLE "belgeler"
  ADD COLUMN IF NOT EXISTS "siparis_no" TEXT,
  ADD COLUMN IF NOT EXISTS "siparis_tarihi" DATE;
