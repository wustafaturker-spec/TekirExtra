-- Tevkifatlı faturanın iadesi (EBLG-61). Satırında tevkifat kodu olan iade
-- TEVKIFATIADE tipinde, tevkifatsız düzenlenir.
ALTER TYPE "FaturaSenaryo" ADD VALUE IF NOT EXISTS 'tevkifatiade';
