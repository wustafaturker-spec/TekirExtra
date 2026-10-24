import * as argon2 from "argon2";
import { generateSecret, generateSync } from "otplib";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sifrele } from "../core/kripto";
import { baglamlaCalistir } from "../core/istek-baglami";
import type { PrismaService } from "../core/prisma.service";
import { AuthService } from "./auth.service";
import { GirisDenemeSayaci } from "./giris-deneme-sayaci";
import { KURTARMA_KODU_SAYISI, kurtarmaKoduOzeti } from "./kurtarma-kodlari";

const TENANT = "00000000-0000-0000-0000-0000000000aa";
const KULLANICI = "00000000-0000-0000-0000-000000000001";
const PAROLA = "Parola2026xx";

beforeAll(() => {
  process.env.BAGLANTI_SIFRELEME_ANAHTARI ??= "0123456789abcdef".repeat(4);
});

function kur() {
  const secret = generateSecret();
  const k = {
    id: KULLANICI, tenantId: TENANT, eposta: "k@ornek.com", adSoyad: "Kişi", rol: "muhasebe", aktif: true, epostaDogrulandi: true,
    parolaHash: "", totpAktif: false, totpSecretSifreli: null as string | null, totpKurtarmaOzetleri: [] as string[],
  };
  const denetim: { islem: string; detay?: unknown }[] = [];
  const tx = {
    user: {
      findUnique: vi.fn(async () => ({ ...k, totpKurtarmaOzetleri: [...k.totpKurtarmaOzetleri] })),
      update: vi.fn(async ({ data }: { data: Partial<typeof k> }) => Object.assign(k, data)),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: { islem: string; detay?: unknown } }) => { denetim.push(data); return data; }) },
    // UPDATE … array_remove … RETURNING: özet dizideyse çıkarır.
    $queryRaw: vi.fn(async (_s: TemplateStringsArray, ozet: string) => {
      const i = k.totpKurtarmaOzetleri.indexOf(ozet);
      if (i < 0) return [];
      k.totpKurtarmaOzetleri.splice(i, 1);
      return [{ kalan: k.totpKurtarmaOzetleri.length }];
    }),
  };
  const prisma = {
    tenantIslem: vi.fn(async (_t: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    authKimlik: { findUnique: vi.fn(async () => ({ tenantId: TENANT, userId: KULLANICI })) },
    oturum: { create: vi.fn(async () => ({})) },
  };
  const jwt = { signAsync: vi.fn(async () => "erisim-token") };
  const service = new AuthService(prisma as unknown as PrismaService, jwt as never, GirisDenemeSayaci.bellekte());
  const olarak = <T>(is: () => Promise<T>) => baglamlaCalistir({ tenantId: TENANT, userId: KULLANICI, rol: "muhasebe" }, is);
  const totpKodu = () => generateSync({ secret });
  return { k, secret, denetim, service, olarak, totpKodu };
}

async function etkinKur() {
  const t = kur();
  t.k.parolaHash = await argon2.hash(PAROLA);
  t.k.totpSecretSifreli = sifrele(t.secret);
  const { kurtarmaKodlari } = await t.olarak(() => t.service.totpEtkinlestir(t.totpKodu()));
  return { ...t, kurtarmaKodlari };
}

describe("2FA kurtarma kodları (yönetim P1-1)", () => {
  let t: Awaited<ReturnType<typeof etkinKur>>;
  beforeEach(async () => { t = await etkinKur(); });

  it("etkinleştirmede 10 kod bir kez döner, veritabanında yalnız özetleri durur", () => {
    expect(t.kurtarmaKodlari).toHaveLength(KURTARMA_KODU_SAYISI);
    expect(new Set(t.kurtarmaKodlari).size).toBe(KURTARMA_KODU_SAYISI);
    expect(t.kurtarmaKodlari[0]).toMatch(/^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
    expect(t.k.totpKurtarmaOzetleri).toEqual(t.kurtarmaKodlari.map(kurtarmaKoduOzeti));
    expect(t.k.totpKurtarmaOzetleri.join()).not.toContain(t.kurtarmaKodlari[0].replace("-", ""));
  });

  it("girişte kurtarma kodu kabul edilir (küçük harf, tiresiz), bir kez geçer", async () => {
    const kod = t.kurtarmaKodlari[3].toLowerCase().replace("-", " ");
    await expect(t.service.giris(t.k.eposta, PAROLA, kod)).resolves.toMatchObject({ accessToken: "erisim-token" });
    expect(t.k.totpKurtarmaOzetleri).toHaveLength(KURTARMA_KODU_SAYISI - 1);
    expect(t.denetim.at(-1)).toMatchObject({ islem: "kurtarma_kodu_kullanildi", detay: { kalan: 9 } });
    await expect(t.service.giris(t.k.eposta, PAROLA, kod)).rejects.toThrow(/TOTP kodu geçersiz/);
  });

  it("uygulama kodu girişte çalışmaya devam eder, kurtarma kodunu harcamaz", async () => {
    await expect(t.service.giris(t.k.eposta, PAROLA, t.totpKodu())).resolves.toBeTruthy();
    expect(t.k.totpKurtarmaOzetleri).toHaveLength(KURTARMA_KODU_SAYISI);
  });

  it("kullanıcı kurtarma koduyla 2FA'yı kapatabilir; yanlış kodda kapanmaz", async () => {
    await expect(t.olarak(() => t.service.totpKapat("ABCDE-FGHJK"))).rejects.toThrow(/geçersiz/);
    expect(t.k.totpAktif).toBe(true);
    await t.olarak(() => t.service.totpKapat(t.kurtarmaKodlari[0]));
    expect(t.k).toMatchObject({ totpAktif: false, totpSecretSifreli: null, totpKurtarmaOzetleri: [] });
    expect(t.denetim.at(-1)).toMatchObject({ islem: "iki_adimli_dogrulama_kapatildi" });
    await expect(t.olarak(() => t.service.totpDurum())).resolves.toEqual({ aktif: false, kalanKurtarmaKodu: 0 });
  });

  it("kod yenileme yalnız uygulama koduyla olur ve eski kodları geçersiz kılar", async () => {
    await expect(t.olarak(() => t.service.kurtarmaKodlariniYenile(t.kurtarmaKodlari[0]))).rejects.toThrow(/geçersiz/);
    const { kurtarmaKodlari: yeni } = await t.olarak(() => t.service.kurtarmaKodlariniYenile(t.totpKodu()));
    expect(yeni).toHaveLength(KURTARMA_KODU_SAYISI);
    await expect(t.service.giris(t.k.eposta, PAROLA, t.kurtarmaKodlari[1])).rejects.toThrow(/TOTP kodu geçersiz/);
    await expect(t.service.giris(t.k.eposta, PAROLA, yeni[1])).resolves.toBeTruthy();
  });
});
