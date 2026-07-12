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

  it("karZararRaporu satis faturalarindan kar ve maliyet analizi cikarir (RPR-05)", async () => {
    const mockTx = {
      faturaSatir: {
        findMany: vi.fn().mockResolvedValue([
          {
            stokId: "stok-1",
            miktar: new Prisma.Decimal(2),
            matrah: new Prisma.Decimal(100.0), // 2 adet satıldı, toplam 100 TL matrah
            stok: {
              kod: "STK01",
              ad: "Ürün A",
              ortalamaMaliyet: new Prisma.Decimal(30.0), // maliyeti 30 TL
            },
          },
        ]),
      },
    };
    mockTenantIslem.mockImplementation((tenantId, cb) => cb(mockTx));

    const sonuc = await service.karZararRaporu();

    // 2 adet * 30 TL = 60 TL maliyet
    // Ciro = 100 TL
    // Kar = 40 TL, Karlılık = 40%
    expect(sonuc.genelCiro).toBe("100.00");
    expect(sonuc.genelMaliyet).toBe("60.00");
    expect(sonuc.genelKar).toBe("40.00");
    expect(sonuc.genelKarlilikYuzdesi).toBe("40.00");
    expect(sonuc.urunAnalizleri[0].kar).toBe("40.00");
  });

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
