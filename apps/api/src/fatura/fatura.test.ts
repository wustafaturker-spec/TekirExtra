import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { FaturaService } from "./fatura.service";
import { BadRequestException } from "@nestjs/common";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({
    tenantId: "t1-uuid",
    userId: "u1-uuid",
    rol: "satis",
  }),
}));

describe("FaturaService (FTR-14 - maksIskontoYuzdesi)", () => {
  const mockTenantIslem = vi.fn();
  const mockPrisma = {
    tenantIslem: mockTenantIslem,
  } as any;
  const mockEposta = {} as any;
  const service = new FaturaService(mockPrisma, mockEposta);

  it("maksIskontoYuzdesi asildiginda BadRequestException firlatir", async () => {
    const mockTx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "u1-uuid",
          maksIskontoYuzdesi: new Prisma.Decimal("10.00"),
        }),
      },
    };
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(mockTx));

    // Case 1: Line discount exceeds limit
    const girdi1 = {
      cariId: "c1",
      tip: "satis" as const,
      tarih: "2026-07-13",
      satirlar: [
        {
          stokId: "s1",
          miktar: "1",
          birim: "adet",
          birimFiyat: "100",
          iskontoOrani: "15", // Exceeds 10%
          kdvOrani: "20",
        },
      ],
    };

    await expect(service.olustur(girdi1)).rejects.toThrow(
      new BadRequestException("Satır 1 için maksimum iskonto yetkiniz (%10) aşılmıştır.")
    );

    // Case 2: General discount exceeds limit
    const girdi2 = {
      cariId: "c1",
      tip: "satis" as const,
      tarih: "2026-07-13",
      genelIskontoYuzdesi: "12", // Exceeds 10%
      satirlar: [
        {
          stokId: "s1",
          miktar: "1",
          birim: "adet",
          birimFiyat: "100",
          iskontoOrani: "5",
          kdvOrani: "20",
        },
      ],
    };

    await expect(service.olustur(girdi2)).rejects.toThrow(
      new BadRequestException("Maksimum iskonto yetkiniz (%10) aşılmıştır.")
    );
  });
});
