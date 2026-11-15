/**
 * Üretimde depodaki örnek/geliştirme sırlarıyla açılmayı engeller.
 *
 * `.env.example`, `.env.docker` ve `docker-compose.yml` herkese açık depoda
 * durduğu için içlerindeki değerler gizli değildir: bunlarla imzalanan JWT
 * ya da şifrelenen entegratör kimlik bilgisi herkesçe üretilebilir/çözülebilir.
 *
 * Yerel docker-compose imajı da NODE_ENV=production ile çalıştırdığından
 * yalnız yerel ortam için `GUVENSIZ_ORNEK_SIRLARA_IZIN_VER=true` istisnası
 * vardır (yalnız `.env.docker` içinde açıktır; gerçek kurulumda kullanılmaz).
 */

import { makbuzSirlariniOku } from "../../pos/makbuz-anahtari";

/** Depoda yayımlanmış, gizli sayılamayacak değerler. */
const BILINEN_ORNEK_SIRLAR = new Set([
  "dev-jwt-secret-degistir",
  "dev-platform-jwt-secret-degistir",
  "dev-oturum-isareti-degistir-0123456789abcdef",
]);

/** docker-compose ve docker/postgres-init.sql içindeki örnek veritabanı ve dosya deposu parolaları. */
const ORNEK_ALTYAPI_PAROLALARI = new Set(["tekir", "tekir_app_dev", "tekir_platform_dev", "tekir-minio-dev"]);

const EN_AZ_JWT_UZUNLUGU = 32;

type Ortam = Record<string, string | undefined>;

/** Üretim ortamında bulunan sır sorunlarını döndürür; boş liste sorun yok demektir. */
export function uretimSirSorunlari(ortam: Ortam = process.env): string[] {
  if (ortam.NODE_ENV !== "production") return [];
  if (ortam.GUVENSIZ_ORNEK_SIRLARA_IZIN_VER === "true") return [];

  const sorunlar: string[] = [];
  const deger = (ad: string) => ortam[ad]?.trim() ?? "";
  const ornekMi = (ad: string) => BILINEN_ORNEK_SIRLAR.has(deger(ad));

  const jwt = deger("JWT_SECRET");
  if (!jwt) sorunlar.push("JWT_SECRET tanımlı değil");
  else if (ornekMi("JWT_SECRET")) sorunlar.push("JWT_SECRET depodaki örnek değer");
  else if (jwt.length < EN_AZ_JWT_UZUNLUGU) sorunlar.push(`JWT_SECRET en az ${EN_AZ_JWT_UZUNLUGU} karakter olmalı`);

  if (deger("PLATFORM_JWT_SECRET") && ornekMi("PLATFORM_JWT_SECRET")) sorunlar.push("PLATFORM_JWT_SECRET depodaki örnek değer");
  if (deger("OTURUM_ISARETI_SECRET") && ornekMi("OTURUM_ISARETI_SECRET")) sorunlar.push("OTURUM_ISARETI_SECRET depodaki örnek değer");

  // Tek karakterin tekrarı (örnekteki 64 sıfır gibi) uzunluk denetimini geçse de anahtar değildir.
  const anahtar = deger("BAGLANTI_SIFRELEME_ANAHTARI");
  if (anahtar && /^(.)\1*$/.test(anahtar)) sorunlar.push("BAGLANTI_SIFRELEME_ANAHTARI tek karakterin tekrarı (örnek değer)");

  // SEC-23: makbuz bağlantı sırrı şifreleme anahtarından ayrıdır; yoksa ya da bozuksa açılmaz.
  if (!deger("MAKBUZ_ANAHTAR_SIRLARI")) sorunlar.push("MAKBUZ_ANAHTAR_SIRLARI tanımlı değil (\"v1:<openssl rand -hex 32>\")");
  else {
    try { makbuzSirlariniOku(ortam); } catch (hata) { sorunlar.push(hata instanceof Error ? hata.message : "MAKBUZ_ANAHTAR_SIRLARI geçersiz"); }
  }

  for (const ad of ["DATABASE_URL", "DATABASE_URL_MIGRATE", "DATABASE_URL_PLATFORM"]) {
    if (!deger(ad)) continue;
    let parola = "";
    try { parola = decodeURIComponent(new URL(deger(ad)).password); } catch { sorunlar.push(`${ad} geçerli bir adres değil`); continue; }
    if (ORNEK_ALTYAPI_PAROLALARI.has(parola)) sorunlar.push(`${ad} depodaki örnek parolayı kullanıyor`);
  }
  // Tanımsızsa dosya deposu istemcisi koddaki örnek anahtara düşer.
  const depo = deger("S3_GIZLI_ANAHTAR");
  if (!depo) sorunlar.push("S3_GIZLI_ANAHTAR tanımlı değil");
  else if (ORNEK_ALTYAPI_PAROLALARI.has(depo)) sorunlar.push("S3_GIZLI_ANAHTAR depodaki örnek değer");

  return sorunlar;
}

/** Açılışta çağrılır; sorun varsa süreç başlamadan hata verir. */
export function uretimSirlariniDenetle(ortam: Ortam = process.env): void {
  const sorunlar = uretimSirSorunlari(ortam);
  if (!sorunlar.length) return;
  throw new Error(
    `Üretimde güvensiz sır yapılandırması: ${sorunlar.join("; ")}. ` +
      "Güçlü rastgele değerler üretin (ör. `openssl rand -hex 32`).",
  );
}
