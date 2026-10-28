/**
 * MVZ-04: platform ekibi kullanıcısı açar (Mevzuat Merkezi paneli).
 * PLT-07: yalnız ilk kurulum içindir; sonraki kullanıcılar platform panelindeki
 * Kullanıcılar ekranından davetle açılır.
 *
 *   node --env-file=.env dist/platform-kullanici-olustur.js <eposta> "<Ad Soyad>" [yonetici|mevzuat_editoru]
 *
 * Parola ve iki adımlı doğrulama anahtarı burada üretilir ve bir kez ekrana
 * yazılır; doğrulayıcı uygulamaya `otpauth://` bağlantısı (ya da anahtar)
 * eklenir. Aynı e-posta varsa parola ve anahtar yenilenir. Kiracı paneli
 * platform kullanıcısı açamaz. PLT-06: rol verilmezse yeni kullanıcı
 * yönetici olur, var olanın rolü değişmez.
 */
import { PrismaClient, type PlatformRol } from "@prisma/client";
import * as argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { generateSecret, generateURI } from "otplib";
import { sifrele } from "./core/kripto";

async function main() {
  const [eposta, adSoyad, rolGirdisi] = process.argv.slice(2);
  const rol = rolGirdisi as PlatformRol | undefined;
  if (!eposta || !/^[^@\s]+@[^@\s]+$/.test(eposta) || !adSoyad?.trim() || (rol && rol !== "yonetici" && rol !== "mevzuat_editoru")) {
    console.error('Kullanım: node --env-file=.env dist/platform-kullanici-olustur.js <eposta> "<Ad Soyad>" [yonetici|mevzuat_editoru]');
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
    const k = await prisma.platformKullanici.upsert({ where: { eposta: e }, create: { eposta: e, ...veri, ...(rol ? { rol } : {}) }, update: { ...veri, ...(rol ? { rol } : {}) } });
    await prisma.mevzuatOlay.create({ data: { olay: "platform_kullanicisi_kuruldu", detay: { eposta: e, rol: k.rol } } });
    console.log(`Platform kullanıcısı hazır: ${e} (${k.rol === "yonetici" ? "platform yöneticisi" : "mevzuat editörü"})`);
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
