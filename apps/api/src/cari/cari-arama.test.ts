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

  it("CRM gorev durumunu cari kimligiyle sinirlar", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const update = vi.fn();
    const prisma = {
      tenantIslem: vi.fn((_tenantId, calistir) => calistir({ crmGorev: { findFirst, update } })),
    } as any;
    const servis = new CariService(prisma, {} as any);

    await expect(servis.crmGorevDurum("cari-1", "gorev-1", "tamamlandi"))
      .rejects.toThrow("CRM görevi bulunamadı");

    expect(findFirst).toHaveBeenCalledWith({ where: { id: "gorev-1", cariId: "cari-1" } });
    expect(update).not.toHaveBeenCalled();
  });

  it("CRM teklif gecmisinde yalniz carinin tekliflerini sorgular", async () => {
    const belgeFindMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      tenantIslem: vi.fn((_tenantId, calistir) => calistir({
        crmEtkilesim: { findMany: vi.fn().mockResolvedValue([]) },
        crmGorev: { findMany: vi.fn().mockResolvedValue([]) },
        belge: { findMany: belgeFindMany },
        user: { findMany: vi.fn().mockResolvedValue([]) },
      })),
    } as any;
    const servis = new CariService(prisma, {} as any);
    vi.spyOn(servis, "getir").mockResolvedValue({ id: "cari-1" } as any);

    await servis.crmGetir("cari-1");

    expect(belgeFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { cariId: "cari-1", tur: "teklif" },
    }));
  });
});
