import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { istekBaglami } from "../core/istek-baglami";
import { AbonelikGuard } from "./abonelik.guard";
import { SALT_OKUMA_ANAHTAR } from "./public.decorator";

function kur(kisitli: boolean) {
  const erisim = { modulleriGetir: vi.fn<() => Promise<string[] | null>>(async () => null), getir: vi.fn(async () => ({ kisitli, neden: kisitli ? "Aboneliğiniz askıya alındı." : null })) };
  const dene = (method: string, path: string, opts: { saltOkuma?: boolean; baglamsiz?: boolean } = {}) => {
    const reflector = { getAllAndOverride: (k: string) => (k === SALT_OKUMA_ANAHTAR ? Boolean(opts.saltOkuma) : undefined) };
    const guard = new AbonelikGuard(reflector as never, erisim as never);
    const context = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ method, path }) }) } as never;
    const deger = opts.baglamsiz ? undefined : { tenantId: "t1", userId: "u1", rol: "muhasebe" as const };
    return istekBaglami.run(deger ? { deger } : {}, () => guard.canActivate(context));
  };
  return { dene, erisim };
}

describe("salt okunur firma (platform P0-1)", () => {
  it("kapalı modülü GET, yazma ve salt okuma POST'unda da reddeder; ayarlar korunur", async () => {
    const k = kur(false); k.erisim.modulleriGetir.mockResolvedValue(["cari"]);
    await expect(k.dene("GET", "/api/v1/fatura")).rejects.toThrow("paketinizde kapalı");
    await expect(k.dene("POST", "/api/v1/fatura", { saltOkuma: true })).rejects.toThrow("paketinizde kapalı");
    await expect(k.dene("POST", "/api/v1/fatura")).rejects.toThrow("paketinizde kapalı");
    await expect(k.dene("GET", "/api/v1/cari")).resolves.toBe(true);
    await expect(k.dene("GET", "/api/v1/abonelik")).resolves.toBe(true);
  });
  it("kısıtlı firmada yazma isteği nedeniyle reddedilir", async () => {
    const { dene } = kur(true);
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) await expect(dene(m, "/api/v1/fatura")).rejects.toThrow(ForbiddenException);
    await expect(dene("POST", "/api/v1/fatura")).rejects.toThrow(/askıya alındı/);
  });

  it("okuma, işaretli okuma POST'u, oturum/abonelik/bildirim yolları açık kalır", async () => {
    const { dene, erisim } = kur(true);
    await expect(dene("GET", "/api/v1/fatura")).resolves.toBe(true);
    await expect(dene("POST", "/api/v1/raporlar/x/excel", { saltOkuma: true })).resolves.toBe(true);
    for (const yol of ["/api/v1/auth/parola/degistir", "/api/v1/abonelik/yeniden-etkinlestir", "/api/v1/abonelik/plan-talebi", "/api/v1/bildirimler/okundu", "/api/v1/kullanim/olay"]) {
      await expect(dene("POST", yol)).resolves.toBe(true);
    }
    expect(erisim.getir).not.toHaveBeenCalled();
  });

  it("kiracı bağlamı olmayan (public/platform) istek ve kısıtsız firma geçer", async () => {
    await expect(kur(true).dene("POST", "/api/v1/platform/firmalar/x/durum", { baglamsiz: true })).resolves.toBe(true);
    await expect(kur(false).dene("POST", "/api/v1/fatura")).resolves.toBe(true);
  });
});
