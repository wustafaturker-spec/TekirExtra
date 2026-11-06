import * as argon2 from "argon2";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { McpAnahtarService } from "../ai/mcp/mcp-anahtar.service";
import type { GuvenlikPolitikasi } from "../core/guvenlik-politikasi";
import { baglamlaCalistir, istekBaglami } from "../core/istek-baglami";
import { KullaniciDurumService } from "../core/kullanici-durum.service";
import type { PrismaService } from "../core/prisma.service";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { GirisDenemeSayaci } from "./giris-deneme-sayaci";
import { IKI_ADIM_KURULUMUNDA_ACIK_ANAHTAR } from "./public.decorator";

const GUN = 24 * 60 * 60_000;
let hash: string;
beforeAll(async () => { hash = await argon2.hash("DogruParola2026"); });

interface Oturum { id: string; userId: string; refreshTokenHash: string; gecerlilikSonu: Date; createdAt: Date; girisAt: Date }

function kur(politika: Partial<GuvenlikPolitikasi> = {}) {
  const p: GuvenlikPolitikasi = { ikiAdimZorunluRoller: [], oturumSuresiGun: 30, hareketsizlikDk: null, ...politika };
  const kullanici = { id: "u1", tenantId: "t1", eposta: "k@ornek.com", adSoyad: "Kişi", rol: "muhasebe", aktif: true, epostaDogrulandi: true, parolaHash: hash, totpAktif: false, totpSecretSifreli: null, totpKurtarmaOzetleri: [], oturumSurumu: 0 };
  const oturumlar: Oturum[] = [];
  const tx = {
    tenant: { findUnique: vi.fn(async () => p) },
    user: { findUnique: vi.fn(async () => kullanici), update: vi.fn(async () => kullanici) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    tenantIslem: vi.fn(async (_t: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    authKimlik: { findFirst: vi.fn(async () => ({ tenantId: "t1", userId: "u1" })) },
    oturum: {
      create: vi.fn(async ({ data }: { data: Omit<Oturum, "id" | "createdAt"> }) => { const o = { ...data, id: `o${oturumlar.length + 1}`, createdAt: new Date() } as Oturum; oturumlar.push(o); return o; }),
      findUnique: vi.fn(async ({ where }: { where: { refreshTokenHash: string } }) => oturumlar.find((o) => o.refreshTokenHash === where.refreshTokenHash) ?? null),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => oturumlar.splice(oturumlar.findIndex((o) => o.id === where.id), 1)[0]),
    },
  };
  const service = new AuthService(prisma as unknown as PrismaService, { signAsync: async () => "erisim" } as never, GirisDenemeSayaci.bellekte(), { unut: vi.fn() } as never);
  return { service, kullanici, oturumlar, p, prisma };
}

describe("oturum süresi politikası (KLN-22)", () => {
  it("açık kalma süresi girişten sayılır; yenileme uzatmaz", async () => {
    const k = kur({ oturumSuresiGun: 7 });
    const g = await k.service.giris("k@ornek.com", "DogruParola2026");
    expect(g.gecerlilikSonu.getTime() - k.oturumlar[0].girisAt.getTime()).toBe(7 * GUN);
    const y = await k.service.yenile(g.refreshToken);
    expect(y.gecerlilikSonu.getTime()).toBe(g.gecerlilikSonu.getTime());
  });

  it("politika kısalınca eski oturum bir sonraki yenilemede düşer", async () => {
    const k = kur({ oturumSuresiGun: 30 });
    const g = await k.service.giris("k@ornek.com", "DogruParola2026");
    k.oturumlar[0].girisAt = new Date(Date.now() - 3 * GUN);
    k.p.oturumSuresiGun = 2;
    await expect(k.service.yenile(g.refreshToken)).rejects.toThrow(/süresi doldu/);
    expect(k.oturumlar).toHaveLength(0);
  });

  it("son yenilemesi hareketsizlik süresinden eski oturum yenilenmez; süre içindeki yenilenir", async () => {
    const k = kur({ hareketsizlikDk: 15 });
    const g = await k.service.giris("k@ornek.com", "DogruParola2026");
    k.oturumlar[0].createdAt = new Date(Date.now() - 10 * 60_000);
    const y = await k.service.yenile(g.refreshToken);
    k.oturumlar[0].createdAt = new Date(Date.now() - 17 * 60_000);
    await expect(k.service.yenile(y.refreshToken)).rejects.toThrow(/işlem yapılmadığı/);
    expect(k.oturumlar).toHaveLength(0);
  });
});

describe("2FA zorunluluğu (KLN-21)", () => {
  it("giriş yapılır ama kurulum gerektiği bildirilir; 2FA kurulu kullanıcıda bildirilmez", async () => {
    const k = kur({ ikiAdimZorunluRoller: ["muhasebe"] });
    expect((await k.service.giris("k@ornek.com", "DogruParola2026")).kullanici.ikiAdimKurulumuGerekli).toBe(true);
    k.p.ikiAdimZorunluRoller = ["satis"];
    expect((await k.service.giris("k@ornek.com", "DogruParola2026")).kullanici.ikiAdimKurulumuGerekli).toBe(false);
  });

  it("zorunlu roldeki kullanıcı 2FA'sını kapatamaz", async () => {
    const k = kur({ ikiAdimZorunluRoller: ["muhasebe"] });
    await expect(baglamlaCalistir({ tenantId: "t1", userId: "u1", rol: "muhasebe" }, () => k.service.totpKapat("123456"))).rejects.toThrow(/kapatılamaz/);
  });

  describe("guard", () => {
    const jwt = new JwtService({ secret: "kiraci-anahtari" });
    let totpAktif: boolean;
    let roller: string[];
    beforeEach(() => { process.env.JWT_SECRET = "kiraci-anahtari"; totpAktif = false; roller = ["muhasebe"]; });
    const dene = async (kurulumdaAcik: boolean) => {
      const reflector = { getAllAndOverride: (anahtar: string) => anahtar === IKI_ADIM_KURULUMUNDA_ACIK_ANAHTAR && kurulumdaAcik } as unknown as Reflector;
      const prisma = { tenantIslem: async (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn({ user: { findUnique: async () => ({ aktif: true, rol: "muhasebe", oturumSurumu: 0, totpAktif }) }, tenant: { findUnique: async () => ({ ikiAdimZorunluRoller: roller }) } }) };
      const guard = new AuthGuard(jwt, reflector, new KullaniciDurumService(prisma as never));
      const token = await jwt.signAsync({ sub: "u1", tenantId: "t1", rol: "muhasebe", sv: 0 });
      const context = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }) } as never;
      return istekBaglami.run({}, () => guard.canActivate(context));
    };

    it("kurulmamışsa sıradan uç 403 ve kodla reddedilir, Hesap Güvenliği uçları açıktır", async () => {
      const hata = await dene(false).catch((h: unknown) => h);
      expect(hata).toBeInstanceOf(ForbiddenException);
      expect((hata as ForbiddenException).getResponse()).toMatchObject({ kod: "IKI_ADIM_KURULUMU_GEREKLI" });
      await expect(dene(true)).resolves.toBe(true);
    });

    it("2FA kurulu ya da rol zorunlu değilse her uç açıktır", async () => {
      totpAktif = true;
      await expect(dene(false)).resolves.toBe(true);
      totpAktif = false;
      roller = ["satis"];
      await expect(dene(false)).resolves.toBe(true);
    });
  });

  it("MCP anahtarı 2FA'sı eksik zorunlu rolde çalışmaz", async () => {
    let roller = ["muhasebe"];
    const kayit = { id: "k1", tenantId: "11111111-1111-1111-1111-111111111111", userId: "u1", iptalAt: null, sonKullanim: new Date(), user: { rol: "muhasebe", aktif: true, totpAktif: false } };
    const tx = { aiMcpAnahtari: { findUnique: vi.fn(async () => kayit), update: vi.fn() }, tenant: { findUnique: vi.fn(async () => ({ ikiAdimZorunluRoller: roller })) } };
    const servis = new McpAnahtarService({ tenantIslem: (_t: string, fn: (t: typeof tx) => unknown) => fn(tx) } as never);
    const anahtar = `tkx_${kayit.tenantId.replace(/-/g, "")}_${"a".repeat(43)}`;
    expect(await servis.dogrula(anahtar)).toBeNull();
    roller = [];
    expect(await servis.dogrula(anahtar)).toMatchObject({ userId: "u1", rol: "muhasebe" });
  });
});
