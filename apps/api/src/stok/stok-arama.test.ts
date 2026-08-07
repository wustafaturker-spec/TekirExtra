import { describe, expect, it, vi } from "vitest";
import { StokService } from "./stok.service";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "yonetici" }),
}));

describe("StokService arama", () => {
  it("tedarikci urun kodunu ad, kod ve barkodla ayni sorguda arar", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      tenantIslem: vi.fn((_tenantId, calistir) => calistir({ stokKart: { findMany } })),
    } as any;
    const servis = new StokService(prisma, {} as any, {} as any);

    await servis.listele("TED-URUN-42");

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{
          tedarikciler: { some: { tedarikciUrunKodu: { contains: "TED-URUN-42", mode: "insensitive" } } },
        }]),
      }),
      include: expect.objectContaining({
        tedarikciler: { select: { tedarikciUrunKodu: true } },
      }),
    }));
  });
});
