import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { RaporService } from "./rapor.service";

vi.mock("../core/istek-baglami", () => ({
  aktifBaglam: () => ({
    tenantId: "t1-uuid",
    rol: "yonetici",
  }),
}));

describe("RaporService (RPR-04..05)", () => {
  const mockTenantIslem = vi.fn();
  const mockPrisma = {
    tenantIslem: mockTenantIslem,
  } as any;

  const service = new RaporService(mockPrisma);

  it("finansalOzet sirket genel finansal durumunu listeler (RPR-04)", async () => {
    const mockTx = {
      kasaBankaHareket: {
        groupBy: vi.fn().mockResolvedValue([
          { tip: "tahsilat", _sum: { tutarTry: new Prisma.Decimal(1000.0) } },
          { tip: "tediye", _sum: { tutarTry: new Prisma.Decimal(300.0) } },
        ]),
      },
      stokKart: {
        findMany: vi.fn().mockResolvedValue([
          { mevcutMiktar: new Prisma.Decimal(10), ortalamaMaliyet: new Prisma.Decimal(15.0) }, // 150 TL envanter
        ]),
      },
      cariHesap: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "c1",
            hareketler: [
              { tip: "borc", tutarTry: new Prisma.Decimal(500.0) }, // cari borçlu 500 (bizim alacağımız)
            ],
          },
          {
            id: "c2",
            hareketler: [
              { tip: "alacak", tutarTry: new Prisma.Decimal(200.0) }, // cari alacaklı 200 (bizim borcumuz)
            ],
          },
        ]),
      },
    };
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(mockTx));

    const sonuc = await service.finansalOzet();

    // Nakit varlıklar = 1000 - 300 = 700 TL
    // Envanter değeri = 10 * 15 = 150 TL
    // Alacaklar = 500 TL
    // Borçlar = 200 TL
    // Net varlık = 700 + 150 + 500 - 200 = 1150 TL
    expect(sonuc.nakitVarliklar).toBe("700.00");
    expect(sonuc.envanterDegeri).toBe("150.00");
    expect(sonuc.toplamAlacaklar).toBe("500.00");
    expect(sonuc.toplamBorclar).toBe("200.00");
    expect(sonuc.netVarlikDegeri).toBe("1150.00");
  });
});
