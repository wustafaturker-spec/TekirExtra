-- Üçlü eşleştirme (SAT-11).
--
-- Sipariş–mal kabul–fatura arasındaki miktar ve fiyat farkları Düzeltme
-- Merkezi'ne kendi türüyle düşer. Fark faturayı engellemez; kayıt orada kapanır.

-- AlterEnum
ALTER TYPE "DuzeltmeTuru" ADD VALUE IF NOT EXISTS 'satin_alma';
