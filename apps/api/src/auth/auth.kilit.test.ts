import * as argon2 from "argon2";
import { HttpException } from "@nestjs/common";
import { generateSecret } from "otplib";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../core/prisma.service";
import { AuthService } from "./auth.service";
import { DENEME_SINIRI, GirisDenemeSayaci } from "./giris-deneme-sayaci";

const EPOSTA = "kisi@ornek.com";
const PAROLA = "DogruParola2026";
let hash: string;
beforeAll(async () => { hash = await argon2.hash(PAROLA); });

function kur() {
  const denetim: { islem: string; detay?: unknown }[] = [];
  const kullanici = { id: "u1", tenantId: "t1", eposta: EPOSTA, adSoyad: "Kişi", rol: "muhasebe", aktif: true, epostaDogrulandi: true, parolaHash: hash, totpAktif: false, totpSecretSifreli: null, totpKurtarmaOzetleri: [], oturumSurumu: 0 };
  const tx = {
    // KLN-21/22: politika kaydı yok → varsayılanlar.
    tenant: { findUnique: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => kullanici), update: vi.fn(async () => kullanici) },
    auditLog: { create: vi.fn(async ({ data }: { data: { islem: string; detay?: unknown } }) => { denetim.push(data); return data; }) },
  };
  const prisma = {
    tenantIslem: vi.fn(async (_t: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    authKimlik: { findUnique: vi.fn(async ({ where }: { where: { eposta: string } }) => (where.eposta === EPOSTA ? { tenantId: "t1", userId: "u1" } : null)) },
    oturum: { create: vi.fn(async () => ({})) },
  };
  const service = new AuthService(prisma as unknown as PrismaService, { signAsync: async () => "erisim" } as never, GirisDenemeSayaci.bellekte(), { unut: () => undefined } as never);
  return { service, denetim, kullanici };
}

const durumKodu = async (p: Promise<unknown>) => p.then(() => 200, (h: unknown) => (h instanceof HttpException ? h.getStatus() : 500));

// Her deneme gerçek argon2 doğrulaması yapar; paket koşusunda 5 sn yetmez.
describe("hesap başına deneme sınırı (yönetim P1-3)", { timeout: 30_000 }, () => {
  let k: ReturnType<typeof kur>;
  beforeEach(() => { k = kur(); });

  it(`${DENEME_SINIRI.parola} hatalı paroladan sonra doğru parola da 429 alır; kilit denetim izine bir kez yazılır`, async () => {
    for (let i = 0; i < DENEME_SINIRI.parola; i++) expect(await durumKodu(k.service.giris(EPOSTA, "yanlis-parola-1"))).toBe(401);
    expect(await durumKodu(k.service.giris(EPOSTA, PAROLA))).toBe(429);
    expect(k.denetim.filter((d) => d.islem === "giris_kilitlendi")).toEqual([expect.objectContaining({ detay: { tur: "parola" } })]);
  });

  it("başarılı giriş sayacı sıfırlar", async () => {
    for (let i = 0; i < DENEME_SINIRI.parola - 1; i++) await durumKodu(k.service.giris(EPOSTA, "yanlis-parola-1"));
    expect(await durumKodu(k.service.giris(EPOSTA, PAROLA))).toBe(200);
    for (let i = 0; i < DENEME_SINIRI.parola - 1; i++) expect(await durumKodu(k.service.giris(EPOSTA, "yanlis-parola-1"))).toBe(401);
    expect(await durumKodu(k.service.giris(EPOSTA, PAROLA))).toBe(200);
  });

  it("kayıtsız adres de aynı biçimde kilitlenir (hesap varlığı sızmaz); büyük/küçük harf aynı sayılır", async () => {
    for (let i = 0; i < DENEME_SINIRI.parola; i++) expect(await durumKodu(k.service.giris(i % 2 ? "Yok@Ornek.com" : "yok@ornek.com", "x"))).toBe(401);
    expect(await durumKodu(k.service.giris("yok@ornek.com", "x"))).toBe(429);
    expect(k.denetim).toEqual([]);
  });

  it(`2FA kodu için ayrı ve daha sıkı sınır (${DENEME_SINIRI.totp})`, async () => {
    process.env.BAGLANTI_SIFRELEME_ANAHTARI ??= "0123456789abcdef".repeat(4);
    const { sifrele } = await import("../core/kripto");
    Object.assign(k.kullanici, { totpAktif: true, totpSecretSifreli: sifrele(generateSecret()) });
    for (let i = 0; i < DENEME_SINIRI.totp; i++) expect(await durumKodu(k.service.giris(EPOSTA, PAROLA, "000000"))).toBe(401);
    expect(await durumKodu(k.service.giris(EPOSTA, PAROLA, "000000"))).toBe(429);
    expect(k.denetim.at(-1)).toMatchObject({ islem: "giris_kilitlendi", detay: { tur: "totp" } });
  });
});
