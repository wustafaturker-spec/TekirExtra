import { describe, it, expect, beforeEach, vi } from "vitest";
import { B2bService } from "./b2b.service";

describe("B2bService", () => {
  let service: B2bService;
  let mockPrisma: any;

  beforeEach(() => {
    const cariUuid = "11111111-1111-4111-8111-111111111111";
    const stokUuid = "22222222-2222-4222-8222-222222222222";

    mockPrisma = {
      tenantIslem: vi.fn((tenantId, cb) => cb(mockPrisma)),
      cariHesap: {
        findFirst: vi.fn().mockResolvedValue({ id: cariUuid, varsayilanIskonto: 10 }),
      },
      stokKart: {
        findMany: vi.fn().mockResolvedValue([
          { id: stokUuid, kod: "URUN01", ad: "Laptop", satisFiyati: 1000, kdvOrani: 20 }
        ]),
        findFirst: vi.fn().mockResolvedValue({ id: stokUuid, ad: "Laptop", satisFiyati: 1000, anaBirim: "adet", kdvOrani: 20 }),
      },
      belgeSayac: {
        upsert: vi.fn().mockResolvedValue({ sonSira: 1 }),
      },
      belge: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "belge-1", ...data })),
      }
    };

    service = new B2bService(mockPrisma);
  });

  it("Bayi kataloğunu iskonto indirimi uygulanmış olarak getirmelidir", async () => {
    const katalog = await service.bayiKatalogGetir("tenant-1", "11111111-1111-4111-8111-111111111111");
    expect(katalog).toHaveLength(1);
    expect(katalog[0].bayiBirimFiyati).toBe(900); // 1000 ₺ - %10 İskonto
  });

  it("Bayi siparişi oluşturmalıdır", async () => {
    const siparis = await service.siparisOlustur("tenant-1", {
      cariId: "11111111-1111-4111-8111-111111111111",
      kalemler: [{ stokId: "22222222-2222-4222-8222-222222222222", miktar: 2 }],
      aciklama: "B2B Sipariş"
    });

    expect(mockPrisma.belge.create).toHaveBeenCalled();
    expect(siparis.tur).toBe("siparis");
  });
});
