-- PLT-06: platform rolleri. Mevcut platform kullanıcıları yönetici olur.
CREATE TYPE "PlatformRol" AS ENUM ('yonetici', 'mevzuat_editoru');

ALTER TABLE "platform_kullanicilari" ADD COLUMN "rol" "PlatformRol" NOT NULL DEFAULT 'yonetici';
