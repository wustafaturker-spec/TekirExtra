import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { BelgelerService } from "./belgeler.service";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: "muhasebe" }),
}));

describe("BelgelerService toplu faturalama", () => {
  it("eşzamanlı işlemde kapanan belge sayısı değişirse taslağı geri aldırır", async () => {
    const belge = {
      id: "b1",
      no: "SP-001",
      durum: "onaylandi",
      tur: "siparis",
      cariId: "c1",
      dovizCinsi: "TRY",
      kur: new Prisma.Decimal(1),
      yon: "satis",
      depoId: "d1",
      satirlar: [],
    };
    const tx = {
      belge: {
        findMany: vi.fn().mockResolvedValue([belge]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      fatura: { create: vi.fn().mockResolvedValue({ id: "f1" }) },
      faturaSatir: { create: vi.fn() },
    };
    const prisma = { tenantIslem: vi.fn((_tenantId, calistir) => calistir(tx)) } as any;
    const service = new BelgelerService(prisma, {} as any, {} as any);

    await expect(service.topluFatura({ belgeIds: ["b1"] })).rejects.toThrow(ConflictException);
    expect(tx.belge.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["b1"] }, durum: "onaylandi", faturaId: null },
      data: { durum: "kapandi", faturaId: "f1" },
    });
  });
});
