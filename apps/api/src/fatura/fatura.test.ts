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

  it("yon, durum ve e-Belge filtrelerini veritabani sorgusuna uygular", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    mockTenantIslem.mockImplementation((_tenantId, cb) => cb({ fatura: { findMany } }));

    await service.listele(undefined, undefined, "kesin", undefined, 50, "satis", "hata");

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tip: { in: ["satis", "satis_iade", "proforma"] },
        durum: "kesin",
        ebelge: { is: { durum: { in: ["hata", "ret"] } } },
      },
    }));
  });

  it("iş kuyruğu sayaçlarını TRY ödeme karşılığıyla hesaplar", async () => {
    const fatura = (tip: string, durum: string, toplam: string, odemeler: Array<{ tutarTry: string }>, ebelgeDurum?: string, kur = "1") => ({
      tip, durum, genelToplam: new Prisma.Decimal(toplam), kur: new Prisma.Decimal(kur),
      ebelge: ebelgeDurum ? { durum: ebelgeDurum } : null,
      kasaBankaHarekets: odemeler.map(({ tutarTry }) => ({ tutarTry: new Prisma.Decimal(tutarTry) })),
    });
    const findMany = vi.fn().mockResolvedValue([
      fatura("satis", "taslak", "100", [], "hata"),
      fatura("alis", "taslak", "100", []),
      fatura("satis", "kesin", "100", [{ tutarTry: "20" }]),
      fatura("alis", "kesin", "100", [{ tutarTry: "100" }]),
      fatura("satis_iade", "kesin", "100", []),
      fatura("alis_iade", "kesin", "100", []),
      fatura("satis", "kesin", "100", [{ tutarTry: "200" }], undefined, "2"),
    ]);
    mockTenantIslem.mockImplementation((_tenantId, cb) => cb({ fatura: { findMany } }));

    await expect(service.isKuyruguOzeti()).resolves.toEqual({
      taslakSatis: 1, taslakAlis: 1, ebelgeHata: 1, acikTahsilat: 2, acikOdeme: 1,
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.any(Object) }));
  });
});
