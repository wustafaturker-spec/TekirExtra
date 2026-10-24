-- Yönetim P1-1: 2FA kurtarma kodları (yalnız sha256 özetleri; kullanılan kod diziden çıkar).
ALTER TABLE "users" ADD COLUMN "totp_kurtarma_ozetleri" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
