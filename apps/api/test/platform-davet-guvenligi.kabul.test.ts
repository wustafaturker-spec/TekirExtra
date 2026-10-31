import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { generateSecret, generateSync } from "otplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GirisDenemeSayaci } from "../src/auth/giris-deneme-sayaci";
import { platformBaglamiylaCalistir } from "../src/core/istek-baglami";
import { sifrele } from "../src/core/kripto";
import { PlatformKullanicilarService } from "../src/mevzuat/platform-kullanicilar.service";
import type { PlatformPrismaService } from "../src/mevzuat/platform-prisma.service";

/**
 * PLT-30: davet ve 2FA yeniden kurulumu gerçek PostgreSQL'de, platform rolüyle.
 * Davet tek koşullu yazımla tüketilir; eşzamanlı ikinci tamamlama, pasife alma ve
 * yenileme yarışları tek ve geçerli sonuç bırakır.
 */
const env = resolve(__dirname, "../.env");
if (existsSync(env)) process.loadEnvFile(env);
// Davet e-postası hiçbir koşulda gerçekten gönderilmesin (demo SMTP gerçek).
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = "1";

const yonetici = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL });
function platformAdresi(): string {
  if (process.env.DATABASE_URL_PLATFORM) return process.env.DATABASE_URL_PLATFORM;
  const u = new URL(process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL ?? "");
  u.username = "tekir_platform";
  u.password = "tekir_platform_dev";
  return u.toString();
}
const platform = new PrismaClient({ datasourceUrl: platformAdresi() });
const servis = () => new PlatformKullanicilarService({ db: platform } as unknown as PlatformPrismaService, undefined, GirisDenemeSayaci.bellekte());

const iz = `plt30-${randomUUID().slice(0, 8)}`;
let benId: string;
let sira = 0;
const olarak = <T>(is: () => Promise<T>) => platformBaglamiylaCalistir({ kullaniciId: benId, eposta: "kabul@ornek.invalid", rol: "yonetici" }, is);
const anahtarAl = (baglanti?: string) => new URLSearchParams(new URL(baglanti!).hash.slice(1)).get("anahtar")!;
async function davet(s = servis()) {
  const { kullanici, davet: d } = await olarak(() => s.olustur({ eposta: `${iz}-${sira++}@ornek.invalid`, adSoyad: `${iz} <b>kişi</b>`, rol: "mevzuat_editoru" }));
  return { id: kullanici.id, anahtar: anahtarAl(d.baglanti) };
}

beforeAll(async () => {
  benId = (await yonetici.platformKullanici.create({ data: { eposta: `${iz}-ben@ornek.invalid`, adSoyad: `${iz} ben`, parolaHash: await argon2.hash("x"), totpSecretSifreli: sifrele(generateSecret()), rol: "yonetici" } })).id;
});

afterAll(async () => {
  const kisiler = (await yonetici.platformKullanici.findMany({ where: { eposta: { startsWith: iz } }, select: { id: true } })).map((k) => k.id);
  await yonetici.$executeRaw`DELETE FROM mevzuat_olaylari WHERE kullanici_id = ANY(${kisiler}::uuid[])`;
  await yonetici.platformKullanici.deleteMany({ where: { id: { in: kisiler } } });
  await Promise.all([yonetici.$disconnect(), platform.$disconnect()]);
});

describe("PLT-30 — davet ve 2FA kurulum güvenliği (gerçek PostgreSQL)", () => {
  it("bilgi tekrarında sır değişmez; bağlantı anahtarı URL parçasındadır", async () => {
    const s = servis();
    const d = await davet(s);
    const [a, b] = [await s.davetBilgisi(d.anahtar), await s.davetBilgisi(d.anahtar)];
    expect(b.secret).toBe(a.secret);
    await s.davetTamamla(d.anahtar, { parola: "KabulParola2026", kod: generateSync({ secret: a.secret }) });
    expect((await platform.platformKullanici.findUniqueOrThrow({ where: { id: d.id } })).davetTuru).toBeNull();
  });

  it("eşzamanlı iki tamamlamadan yalnız biri yazılır", async () => {
    for (let i = 0; i < 5; i++) {
      const [s1, s2] = [servis(), servis()];
      const d = await davet(s1);
      const kod = generateSync({ secret: (await s1.davetBilgisi(d.anahtar)).secret });
      const sonuc = await Promise.allSettled([s1.davetTamamla(d.anahtar, { parola: "BirinciParola2026", kod }), s2.davetTamamla(d.anahtar, { parola: "IkinciParola2026", kod })]);
      expect(sonuc.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const k = await platform.platformKullanici.findUniqueOrThrow({ where: { id: d.id } });
      const kazanan = sonuc[0].status === "fulfilled" ? "BirinciParola2026" : "IkinciParola2026";
      expect(await argon2.verify(k.parolaHash, kazanan)).toBe(true);
    }
  });

  it("eşzamanlı pasife alma ile tamamlama: hesap pasifse kurulum tamamlanmış sayılmaz", async () => {
    for (let i = 0; i < 5; i++) {
      const s = servis();
      const d = await davet(s);
      const kod = generateSync({ secret: (await s.davetBilgisi(d.anahtar)).secret });
      await Promise.allSettled([s.davetTamamla(d.anahtar, { parola: "KabulParola2026", kod }), olarak(() => s.guncelle(d.id, { aktif: false }))]);
      const k = await platform.platformKullanici.findUniqueOrThrow({ where: { id: d.id } });
      expect(k.aktif).toBe(false);
      // Ya tamamlama önce yazıldı (kurulum bitti, sonra pasife alındı) ya da pasife alma önce: kurulum açık kaldı.
      if (k.davetTuru === null) expect(await argon2.verify(k.parolaHash, "KabulParola2026")).toBe(true);
      else expect(k.davetTuru).toBe("hesap");
    }
  });

  it("yenileme eski bağlantıyı ve sırrı iptal eder; yenilemeden önce tamamlanmışsa yeniden açmaz", async () => {
    const s = servis();
    const d = await davet(s);
    const eski = await s.davetBilgisi(d.anahtar);
    const yeni = anahtarAl((await olarak(() => s.davetYenile(d.id))).baglanti);
    await expect(s.davetTamamla(d.anahtar, { parola: "KabulParola2026", kod: generateSync({ secret: eski.secret }) })).rejects.toThrow(/geçersiz/);
    const bilgi = await s.davetBilgisi(yeni);
    expect(bilgi.secret).not.toBe(eski.secret);
    await s.davetTamamla(yeni, { parola: "KabulParola2026", kod: generateSync({ secret: bilgi.secret }) });
    await expect(olarak(() => s.davetYenile(d.id))).rejects.toThrow(/bekleyen kurulumu yok/);
  });

  it("2FA yeniden kurulumunda 5 hatalı parola hesabı kilitler", async () => {
    const s = servis();
    const d = await davet(s);
    const ilk = await s.davetBilgisi(d.anahtar);
    await s.davetTamamla(d.anahtar, { parola: "KabulParola2026", kod: generateSync({ secret: ilk.secret }) });
    const sifirla = await olarak(() => s.ikiAdimSifirla(d.id));
    const anahtar = anahtarAl(sifirla.baglanti);
    const { secret } = await s.davetBilgisi(anahtar);
    for (let i = 0; i < 5; i++) await expect(s.davetTamamla(anahtar, { parola: "YanlisParola2026", kod: generateSync({ secret }) }, `192.0.2.${i}`)).rejects.toThrow(/Parola hatalı/);
    await expect(s.davetTamamla(anahtar, { parola: "KabulParola2026", kod: generateSync({ secret }) })).rejects.toMatchObject({ status: 429 });
    expect((await platform.platformKullanici.findUniqueOrThrow({ where: { id: d.id } })).davetTuru).toBe("iki_adim");
  });
});
