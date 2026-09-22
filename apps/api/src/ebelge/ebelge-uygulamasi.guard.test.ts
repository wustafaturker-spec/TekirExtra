import { ForbiddenException } from "@nestjs/common";
import { ebelgeUygulamalariCoz, type EbelgeUygulamalari } from "@tekirextra/shared";
import { describe, expect, it, vi } from "vitest";
import { baglamlaCalistir } from "../core/istek-baglami";
import { EbelgeUygulamasiGuard } from "./ebelge-uygulamasi.guard";

const uygulamalar = (elle: Partial<{ efatura: boolean | null; earsiv: boolean | null; eirsaliye: boolean | null }>): EbelgeUygulamalari =>
  ebelgeUygulamalariCoz({
    elle: { efatura: null, earsiv: null, eirsaliye: null, ...elle },
    liste: { efatura: false, eirsaliye: false, guncel: false },
  });

const baglam = { tenantId: "t1", userId: "u1", rol: "yonetici" } as never;
const context = { getHandler: () => () => undefined, getClass: () => class {} } as never;

function kur(gerekli: string[] | undefined, durum: EbelgeUygulamalari) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(gerekli) } as never;
  const servis = { uygulamalar: vi.fn().mockResolvedValue(durum) } as never;
  return new EbelgeUygulamasiGuard(reflector, servis);
}

describe("EbelgeUygulamasiGuard (EBLG-77)", () => {
  it("dekoratörsüz ucu hiç sorgulamadan geçirir", async () => {
    const guard = kur(undefined, uygulamalar({}));

    await expect(baglamlaCalistir(baglam, () => guard.canActivate(context))).resolves.toBe(true);
  });

  it("açık uygulamanın ucunu geçirir", async () => {
    const guard = kur(["earsiv"], uygulamalar({ efatura: false, earsiv: true }));

    await expect(baglamlaCalistir(baglam, () => guard.canActivate(context))).resolves.toBe(true);
  });

  it("kapalı uygulamanın ucunu reddeder", async () => {
    const guard = kur(["efatura"], uygulamalar({ efatura: false, earsiv: true }));

    await expect(baglamlaCalistir(baglam, () => guard.canActivate(context))).rejects.toThrow(ForbiddenException);
  });

  it("birden çok koddan biri açıksa yeter", async () => {
    const guard = kur(["efatura", "earsiv"], uygulamalar({ efatura: false, earsiv: true }));

    await expect(baglamlaCalistir(baglam, () => guard.canActivate(context))).resolves.toBe(true);
  });

  it("durumu bilinmeyen uygulamayı açık saymaz", async () => {
    const guard = kur(["efatura"], uygulamalar({}));

    await expect(baglamlaCalistir(baglam, () => guard.canActivate(context))).rejects.toThrow(/kayıtlı değil/);
  });
});
