import { createHash } from "node:crypto";
import * as argon2 from "argon2";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { baglamlaCalistir } from "../core/istek-baglami";
import type { PrismaService } from "../core/prisma.service";
import { AuthService } from "./auth.service";
import { GirisDenemeSayaci } from "./giris-deneme-sayaci";

const ozet = (t: string) => createHash("sha256").update(t).digest("hex");
let hash: string;
beforeAll(async () => { hash = await argon2.hash("DogruParola2026"); });

interface Oturum { id: string; userId: string; refreshTokenHash: string; gecerlilikSonu: Date; createdAt: Date; girisAt: Date; ip: string | null; tarayici: string | null }

function kur() {
  const kullanici = { id: "u1", tenantId: "t1", eposta: "k@ornek.com", adSoyad: "Kişi", rol: "muhasebe", aktif: true, epostaDogrulandi: true, parolaHash: hash, totpAktif: false, totpSecretSifreli: null, totpKurtarmaOzetleri: [], oturumSurumu: 0, sonGirisAt: null as Date | null };
  const oturumlar: Oturum[] = [];
  const denetim: { islem: string; detay?: unknown }[] = [];
  const tx = {
    user: {
      findUnique: vi.fn(async () => kullanici),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const { oturumSurumu, ...diger } = data as { oturumSurumu?: { increment: number } };
        if (oturumSurumu) kullanici.oturumSurumu += oturumSurumu.increment;
        return Object.assign(kullanici, diger);
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: { islem: string; detay?: unknown } }) => { denetim.push(data); return data; }) },
  };
  const prisma = {
    tenantIslem: vi.fn(async (_t: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    authKimlik: { findUnique: vi.fn(async () => ({ tenantId: "t1", userId: "u1" })) },
    oturum: {
      create: vi.fn(async ({ data }: { data: Omit<Oturum, "id" | "createdAt"> }) => { const o = { ...data, id: `o${oturumlar.length + 1}`, createdAt: new Date() } as Oturum; oturumlar.push(o); return o; }),
      findUnique: vi.fn(async ({ where }: { where: { refreshTokenHash: string } }) => oturumlar.find((o) => o.refreshTokenHash === where.refreshTokenHash) ?? null),
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) => oturumlar.filter((o) => o.userId === where.userId)),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => oturumlar.splice(oturumlar.findIndex((o) => o.id === where.id), 1)[0]),
      deleteMany: vi.fn(async ({ where }: { where: { id?: string; userId: string; NOT?: { refreshTokenHash: string } } }) => {
        const silinecek = oturumlar.filter((o) => o.userId === where.userId && (!where.id || o.id === where.id) && o.refreshTokenHash !== where.NOT?.refreshTokenHash);
        silinecek.forEach((o) => oturumlar.splice(oturumlar.indexOf(o), 1));
        return { count: silinecek.length };
      }),
    },
  };
  const durum = { unut: vi.fn() };
  const service = new AuthService(prisma as unknown as PrismaService, { signAsync: async () => "erisim" } as never, GirisDenemeSayaci.bellekte(), durum as never);
  const olarak = <T>(is: () => Promise<T>) => baglamlaCalistir({ tenantId: "t1", userId: "u1", rol: "muhasebe" }, is);
  return { service, kullanici, oturumlar, denetim, durum, olarak };
}

describe("giriş görünürlüğü ve oturumlarım (yönetim P2-4)", () => {
  it("giriş son giriş zamanını ve istemciyi kaydeder; yenileme giriş anını taşır", async () => {
    const k = kur();
    const g = await k.service.giris("k@ornek.com", "DogruParola2026", undefined, { ip: "10.0.0.5", tarayici: "Mozilla/5.0 Firefox/131" });
    expect(k.kullanici.sonGirisAt).toBeInstanceOf(Date);
    expect(k.denetim).toEqual([expect.objectContaining({ islem: "giris_yapildi", detay: { ip: "10.0.0.5", tarayici: "Mozilla/5.0 Firefox/131" } })]);
    const ilk = k.oturumlar[0];
    expect(ilk).toMatchObject({ ip: "10.0.0.5", tarayici: "Mozilla/5.0 Firefox/131" });
    await k.service.yenile(g.refreshToken, { ip: "10.0.0.9", tarayici: "Mozilla/5.0 Firefox/131" });
    expect(k.oturumlar).toHaveLength(1);
    expect(k.oturumlar[0]).toMatchObject({ girisAt: ilk.girisAt, ip: "10.0.0.9" });
  });

  it("oturum listesi bu oturumu işaretler; diğerlerini kapatma bu oturumu korur, sürümü artırır", async () => {
    const k = kur();
    const bu = await k.service.giris("k@ornek.com", "DogruParola2026");
    await k.service.giris("k@ornek.com", "DogruParola2026");
    await k.service.giris("k@ornek.com", "DogruParola2026");
    const liste = await k.olarak(() => k.service.oturumlarim(bu.refreshToken));
    expect(liste).toHaveLength(3);
    expect(liste.filter((o) => o.buOturum)).toHaveLength(1);
    expect(liste.find((o) => o.buOturum)?.id).toBe(k.oturumlar.find((o) => o.refreshTokenHash === ozet(bu.refreshToken))?.id);
    await expect(k.olarak(() => k.service.digerOturumlariKapat(bu.refreshToken))).resolves.toEqual({ kapatilan: 2 });
    expect(k.oturumlar.map((o) => o.refreshTokenHash)).toEqual([ozet(bu.refreshToken)]);
    expect(k.kullanici.oturumSurumu).toBe(1);
    expect(k.durum.unut).toHaveBeenCalledWith("u1");
  });

  it("başkasının oturumu kapatılamaz", async () => {
    const k = kur();
    await k.service.giris("k@ornek.com", "DogruParola2026");
    k.oturumlar[0].userId = "baska";
    await expect(k.olarak(() => k.service.oturumKapat(k.oturumlar[0].id))).rejects.toThrow(/bulunamadı/);
    expect(k.oturumlar).toHaveLength(1);
  });
});
