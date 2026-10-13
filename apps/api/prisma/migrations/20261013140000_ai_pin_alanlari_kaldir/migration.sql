-- AI-10: 12 Ekim yapay zekâ paketinin eklediği, hiç kullanılmayan PIN ve
-- kullanıcı telefonu alanları kaldırılır (dış kanal ayrı pakette, kendi
-- kimlik doğrulamasıyla gelecek). Uygulama öncesi kolonların boş olduğu
-- doğrulandı (2026-10-13).

ALTER TABLE "users" DROP COLUMN IF EXISTS "pin_kodu";
ALTER TABLE "users" DROP COLUMN IF EXISTS "telefon";
ALTER TABLE "ajan_oturumlari" DROP COLUMN IF EXISTS "pin_kodu";
ALTER TABLE "ajan_oturumlari" DROP COLUMN IF EXISTS "pin_dogrulandi";
