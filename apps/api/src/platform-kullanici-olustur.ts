/**
 * MVZ-04: platform ekibi kullanıcısı açar (Mevzuat Merkezi paneli).
 *
 *   node --env-file=.env dist/platform-kullanici-olustur.js <eposta> "<Ad Soyad>"
 *
 * Parola ve iki adımlı doğrulama anahtarı burada üretilir ve bir kez ekrana
 * yazılır; doğrulayıcı uygulamaya `otpauth://` bağlantısı (ya da anahtar)
 * eklenir. Aynı e-posta varsa parola ve anahtar yenilenir. Kiracı paneli
 * platform kullanıcısı açamaz.
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { generateSecret, generateURI } from "otplib";
import { sifrele } from "./core/kripto";

async function main() {
  const [eposta, adSoyad] = process.argv.slice(2);
  if (!eposta || !/^[^@\s]+@[^@\s]+$/.test(eposta) || !adSoyad?.trim()) {
    console.error('Kullanım: node --env-file=.env dist/platform-kullanici-olustur.js <eposta> "<Ad Soyad>"');
    process.exit(1);
  }
  const adres = process.env.DATABASE_URL_PLATFORM;
  if (!adres) throw new Error("DATABASE_URL_PLATFORM tanımlı değil");
  const prisma = new PrismaClient({ datasourceUrl: adres });
  try {
    const parola = randomBytes(12).toString("base64url");
    const secret = generateSecret();
    const veri = { adSoyad: adSoyad.trim(), parolaHash: await argon2.hash(parola), totpSecretSifreli: sifrele(secret), aktif: true };
    const e = eposta.trim().toLowerCase();
    await prisma.platformKullanici.upsert({ where: { eposta: e }, create: { eposta: e, ...veri }, update: veri });
    await prisma.mevzuatOlay.create({ data: { olay: "platform_kullanicisi_kuruldu", detay: { eposta: e } } });
    console.log(`Platform kullanıcısı hazır: ${e}`);
    console.log(`Parola (bir kez gösterilir): ${parola}`);
    console.log(`Doğrulayıcı anahtarı: ${secret}`);
    console.log(`Kurulum bağlantısı: ${generateURI({ issuer: "TekirExtra Platform", label: e, secret })}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((hata: unknown) => {
  console.error(hata instanceof Error ? hata.message : hata);
  process.exit(1);
});
