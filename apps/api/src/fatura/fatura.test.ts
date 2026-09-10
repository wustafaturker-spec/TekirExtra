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
  const service = new FaturaService(mockPrisma, mockEposta, {} as any, {} as any, {} as any, {} as any, { tarihDogrula: vi.fn() } as any);

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

describe("FaturaService.iptal — e-belge kuralı (EBLG-22)", () => {
  const mockTenantIslem = vi.fn();
  const mockPrisma = { tenantIslem: mockTenantIslem } as any;

  function kur(ebelge: unknown) {
    const earsivBelgesiniIptalEt = vi.fn();
    const tx = {
      fatura: { findUnique: vi.fn().mockResolvedValue({ id: "f1", no: "SNC2026000000003", durum: "kesin", tip: "satis", tarih: new Date(), genelToplam: new Prisma.Decimal("900.00"), cariId: "c1", dovizCinsi: "TRY", kur: new Prisma.Decimal("1"), ebelge }) },
      kasaBankaHareket: { count: vi.fn().mockResolvedValue(0) },
      posTahsilat: { count: vi.fn().mockResolvedValue(0) },
      krediKartiHareket: { count: vi.fn().mockResolvedValue(0) },
      stokHareket: { findMany: vi.fn().mockResolvedValue([]) },
      cariHareket: { create: vi.fn().mockResolvedValue({}) },
      cariHesap: { update: vi.fn().mockResolvedValue({}) },
      belge: { updateMany: vi.fn().mockResolvedValue({}) },
      gelenEbelge: { updateMany: vi.fn().mockResolvedValue({}) },
      fatura2: null,
    } as any;
    tx.fatura.update = vi.fn().mockResolvedValue({ id: "f1", durum: "iptal" });
    mockTenantIslem.mockImplementation((_t: string, cb: (t: unknown) => unknown) => cb(tx));
    const service = new FaturaService(
      mockPrisma, {} as any, { hareketEkle: vi.fn() } as any, {} as any, {} as any, {} as any,
      { tarihDogrula: vi.fn() } as any, {} as any, { earsivBelgesiniIptalEt } as any,
    );
    return { service, tx, earsivBelgesiniIptalEt };
  }

  it("e-Fatura olarak gönderilmiş faturayı iptal etmez, iade faturasına yönlendirir", async () => {
    // Kesilen e-Fatura iptal edilmez; düzeltme yolu iade faturasıdır.
    const { service, earsivBelgesiniIptalEt } = kur({ id: "eb1", tur: "efatura", durum: "iletildi", entegratorRef: "REF" });

    await expect(service.iptal("f1")).rejects.toThrow("iade faturası düzenleyin");
    expect(earsivBelgesiniIptalEt).not.toHaveBeenCalled();
  });

  it("e-Arşiv faturasında belgeyi entegratörde de iptal eder", async () => {
    // Tek adım: iki sistem ya birlikte iptal olur ya hiç.
    const { service, earsivBelgesiniIptalEt } = kur({ id: "eb1", tur: "earsiv", durum: "iletildi", entegratorRef: "EARSIV:x" });

    await service.iptal("f1");

    expect(earsivBelgesiniIptalEt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "f1" }),
      expect.objectContaining({ id: "eb1" }),
    );
  });

  it("entegratör iptali başarısızsa fatura iptal edilmez", async () => {
    // Hata yukarı taşınır ve çağıranın işlemi geri alınır; bizde iptal görünüp
    // GİB'de canlı duran belge kalmaz.
    const { service, tx, earsivBelgesiniIptalEt } = kur({ id: "eb1", tur: "earsiv", durum: "iletildi", entegratorRef: "EARSIV:x" });
    earsivBelgesiniIptalEt.mockRejectedValue(new BadRequestException("GİB raporuna girmiş"));

    await expect(service.iptal("f1")).rejects.toThrow("GİB raporuna girmiş");
    expect(tx.fatura.update).not.toHaveBeenCalled();
  });

  it("zaten iptal edilmiş belgeyi ikinci kez iptal etmeye çalışmaz", async () => {
    const { service, earsivBelgesiniIptalEt } = kur({ id: "eb1", tur: "earsiv", durum: "iptal", entegratorRef: "EARSIV:x" });

    await service.iptal("f1");

    expect(earsivBelgesiniIptalEt).not.toHaveBeenCalled();
  });
});
