-- İhraç kayıtlı senaryosu (EBLG-60). Senaryo satırlardan değil faturadaki
-- işaretten türer; UBL'e IHRACKAYITLI yazılır.
ALTER TYPE "FaturaSenaryo" ADD VALUE IF NOT EXISTS 'ihrackayitli';
