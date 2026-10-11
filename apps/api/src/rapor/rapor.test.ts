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
      // RPR-15: stok değeri SQL'de (eksi stok hariç), cari bakiyesi gruplanarak.
      $queryRaw: vi.fn().mockResolvedValue([{ deger: "150", eksi: 1 }]),
      cariHareket: {
        groupBy: vi.fn().mockResolvedValue([
          { cariId: "c1", dovizCinsi: "TRY", tip: "borc", _sum: { tutar: new Prisma.Decimal(500), tutarTry: new Prisma.Decimal(500) } }, // bizim alacağımız
          { cariId: "c2", dovizCinsi: "TRY", tip: "alacak", _sum: { tutar: new Prisma.Decimal(200), tutarTry: new Prisma.Decimal(200) } }, // bizim borcumuz
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
    expect(sonuc.eksiStokSayisi).toBe(1);
  });
});
