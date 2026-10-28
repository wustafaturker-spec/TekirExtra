import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DestekOturumService } from "../core/destek-oturum.service";
import { baglamAl, DESTEK_KULLANICI_ID, istekBaglami } from "../core/istek-baglami";
import { AuthGuard } from "./auth.guard";
import { DESTEK_OTURUMUNDA_ACIK_ANAHTAR } from "./public.decorator";

const ANAHTAR = "kiraci-anahtari";

describe("destek oturumu (PLT-10)", () => {
  const jwt = new JwtService({ secret: ANAHTAR });
  let etkin: number;
  let okuma: number;
  let denetim: { islem: string; userId: string | null; detay: Record<string, unknown> }[];
  let olaylar: { olay: string; kullaniciId: string }[];
  beforeEach(() => { process.env.JWT_SECRET = ANAHTAR; etkin = 1; okuma = 0; denetim = []; olaylar = []; });

  const tx = {
    destekOturumu: { count: async () => { okuma++; return etkin; } },
    auditLog: { create: async ({ data }: { data: (typeof denetim)[number] }) => { denetim.push(data); return data; } },
  };
  const prisma = { tenantIslem: async (_t: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const platformDb = { db: { mevzuatOlay: { create: async ({ data }: { data: (typeof olaylar)[number] }) => { olaylar.push(data); return data; } } } };
  const durum = new DestekOturumService(prisma as never);

  async function dene(yontem: string, acikUc = false) {
    const reflector = { getAllAndOverride: (a: string) => (a === DESTEK_OTURUMUNDA_ACIK_ANAHTAR ? acikUc : false) } as unknown as Reflector;
    const guard = new AuthGuard(jwt, reflector, undefined, platformDb as never, durum, prisma as never);
    const token = await jwt.signAsync({ sub: DESTEK_KULLANICI_ID, tenantId: "t1", rol: "yonetici", destek: { oid: "o1", ad: "Destek Kişi", ep: "d@x.io", pid: "p1" } });
    const context = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ method: yontem, originalUrl: "/api/v1/cari?adet=5", headers: { authorization: `Bearer ${token}` } }) }) } as never;
    return istekBaglami.run({}, async () => ({ sonuc: await guard.canActivate(context), baglam: baglamAl() }));
  }

  it("GET geçer: salt okunur destek bağlamı kurulur, istek iki kayda destek kişisiyle yazılır", async () => {
    durum.hepsiniUnut();
    const r = await dene("GET");
    expect(r.baglam).toEqual({ tenantId: "t1", userId: DESTEK_KULLANICI_ID, rol: "yonetici", destek: { oturumId: "o1", ad: "Destek Kişi", eposta: "d@x.io" } });
    expect(denetim).toEqual([expect.objectContaining({ islem: "destek_istegi", userId: null, detay: expect.objectContaining({ destekKisi: "Destek Kişi", yontem: "GET", yol: "/api/v1/cari", reddedildi: false }) })]);
    expect(olaylar).toEqual([expect.objectContaining({ olay: "destek_istegi", kullaniciId: "p1" })]);
  });

  it("yazma isteği 403; reddedilen deneme de kayda geçer; işaretli uç açıktır", async () => {
    durum.hepsiniUnut();
    for (const y of ["POST", "PUT", "PATCH", "DELETE"]) await expect(dene(y)).rejects.toThrow(ForbiddenException);
    expect(denetim.every((d) => d.detay.reddedildi === true)).toBe(true);
    await expect(dene("POST", true)).resolves.toMatchObject({ sonuc: true });
  });

  it("oturum kapanınca ya da izin geri alınınca token düşer (önbellek 10 sn)", async () => {
    durum.hepsiniUnut();
    await dene("GET");
    etkin = 0;
    await expect(dene("GET")).resolves.toMatchObject({ sonuc: true }); // önbellekte
    expect(okuma).toBe(1);
    durum.hepsiniUnut();
    await expect(dene("GET")).rejects.toThrow(UnauthorizedException);
  });

  it("destek servisi bağlı değilse destek token'ı geçmez", async () => {
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    const guard = new AuthGuard(jwt, reflector);
    const token = await jwt.signAsync({ sub: DESTEK_KULLANICI_ID, tenantId: "t1", rol: "yonetici", destek: { oid: "o1", ad: "A", ep: "e", pid: "p" } });
    const context = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ method: "GET", headers: { authorization: `Bearer ${token}` } }) }) } as never;
    await expect(istekBaglami.run({}, () => guard.canActivate(context))).rejects.toThrow(UnauthorizedException);
    vi.restoreAllMocks();
  });
});
