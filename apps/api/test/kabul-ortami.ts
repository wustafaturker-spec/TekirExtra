/**
 * Kabul testlerinin ayrı ortamı. Testler eskiden geliştirme veritabanına
 * (pilotla ortak) kiracı açıyor, e-Belge işlerini pilotun Redis kuyruğuna
 * bırakıyordu; 2026-11-06'da 709 test firması pilottan silindi.
 *
 * Pilot adreslerinden kabul adresleri türetilir:
 * - PostgreSQL: aynı sunucu ve roller, veritabanı adı `KABUL_VERITABANI`
 *   (varsayılan `<kaynak>_kabul`),
 * - Redis: aynı sunucu, mantıksal veritabanı `KABUL_REDIS_DB` (varsayılan 1),
 * - nesne deposu: kova `KABUL_S3_KOVA` (varsayılan `<kova>-kabul`).
 * Hedef pilotla aynı çıkarsa test başlamaz.
 */

export const KABUL_DB_ADRESLERI = ["DATABASE_URL", "DATABASE_URL_MIGRATE", "DATABASE_URL_PLATFORM"] as const;
const VARSAYILAN_KOVA = "tekirextra-ekler";

type Ortam = Record<string, string | undefined>;

const dbAdi = (adres: string) => decodeURIComponent(new URL(adres).pathname.replace(/^\//, ""));
const redisDb = (adres: string) => { const yol = new URL(adres).pathname.replace(/^\//, ""); return yol ? Number(yol) : 0; };

/** Kaynak ortamdan kabul ortamının değişkenlerini üretir; güvensizse hata atar. */
export function kabulOrtami(kaynak: Ortam): Record<string, string> {
  const ana = kaynak.DATABASE_URL;
  if (!ana) throw new Error("Kabul ortamı: DATABASE_URL tanımlı değil (apps/api/.env)");
  const kaynakDb = dbAdi(ana);
  const hedefDb = kaynak.KABUL_VERITABANI || `${kaynakDb}_kabul`;
  if (!/kabul/i.test(hedefDb) || hedefDb === kaynakDb) {
    throw new Error(`Kabul ortamı: hedef veritabanı "${hedefDb}" güvenli değil; adı "kabul" içermeli ve "${kaynakDb}" olmamalı`);
  }
  const sonuc: Record<string, string> = { KABUL_ORTAMI: "1", KABUL_KAYNAK_VERITABANI: kaynakDb, KABUL_VERITABANI: hedefDb };
  for (const ad of KABUL_DB_ADRESLERI) {
    const deger = kaynak[ad];
    if (!deger) continue;
    if (dbAdi(deger) !== kaynakDb) throw new Error(`Kabul ortamı: ${ad} başka bir veritabanını (${dbAdi(deger)}) gösteriyor; adresler aynı veritabanında olmalı`);
    const u = new URL(deger);
    u.pathname = `/${encodeURIComponent(hedefDb)}`;
    sonuc[ad] = u.toString();
  }

  const redis = new URL(kaynak.REDIS_URL || "redis://localhost:6380");
  const kaynakRedisDb = redisDb(redis.toString());
  const hedefRedisDb = kaynak.KABUL_REDIS_DB ? Number(kaynak.KABUL_REDIS_DB) : kaynakRedisDb === 1 ? 2 : 1;
  if (!Number.isInteger(hedefRedisDb) || hedefRedisDb < 0 || hedefRedisDb === kaynakRedisDb) {
    throw new Error(`Kabul ortamı: Redis veritabanı ${hedefRedisDb} pilotla (${kaynakRedisDb}) aynı ya da geçersiz`);
  }
  redis.pathname = `/${hedefRedisDb}`;
  sonuc.REDIS_URL = redis.toString();

  const kova = kaynak.S3_KOVA || VARSAYILAN_KOVA;
  const hedefKova = kaynak.KABUL_S3_KOVA || `${kova}-kabul`;
  if (hedefKova === kova) throw new Error(`Kabul ortamı: nesne deposu kovası pilotla aynı (${kova})`);
  sonuc.S3_KOVA = hedefKova;
  return sonuc;
}

/** Yönetim bağlantısıyla `postgres` veritabanına giden adres (CREATE DATABASE için). */
export function sunucuYonetimAdresi(migrateAdresi: string): string {
  const u = new URL(migrateAdresi);
  u.pathname = "/postgres";
  return u.toString();
}
