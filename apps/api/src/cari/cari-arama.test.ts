import { describe, expect, it, vi } from "vitest";
import { CariService } from "./cari.service";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "yonetici" }),
}));

describe("CariService arama", () => {
  it("telefonu unvan, kod ve VKN ile ayni sorguda arar", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      tenantIslem: vi.fn((_tenantId, calistir) => calistir({ cariHesap: { findMany } })),
    } as any;
    const servis = new CariService(prisma, {} as any);

    await servis.listele("0532 123 45 67");

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: expect.arrayContaining([{ telefon: { contains: "0532 123 45 67" } }]) },
    }));
  });

  it("cari tipi ve bloke durumunu veritabani sorgusuna uygular", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      tenantIslem: vi.fn((_tenantId, calistir) => calistir({ cariHesap: { findMany } })),
    } as any;
    const servis = new CariService(prisma, {} as any);

    await servis.listele(undefined, undefined, 50, "musteri", "bloke");

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tip: { in: ["musteri", "her_ikisi"] }, karaListe: true },
    }));
  });
});
