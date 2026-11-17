-- SEC-23 son adım (kullanıcı onayı 2026-11-17): eski düz makbuz anahtarları silinir.
-- Eski bağlantılar makbuz_anahtar_ozeti ile doğrulanmaya devam eder. Geri alınamaz.
-- Güvenlik: özeti eksik ya da uyuşmayan tek kayıt varsa göç durur, hiçbir şey silinmez.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "pos_tahsilatlari"
    WHERE "makbuz_anahtari" IS NOT NULL
      AND ("makbuz_anahtar_ozeti" IS NULL
        OR "makbuz_anahtar_ozeti" <> encode(sha256(convert_to("makbuz_anahtari", 'UTF8')), 'hex'))
  ) THEN
    RAISE EXCEPTION 'SEC-23: özeti eksik/uyuşmayan makbuz anahtarı var; düz anahtar silinmedi';
  END IF;
END $$;

DROP INDEX IF EXISTS "pos_tahsilatlari_makbuz_anahtari_key";
ALTER TABLE "pos_tahsilatlari" DROP COLUMN "makbuz_anahtari";
