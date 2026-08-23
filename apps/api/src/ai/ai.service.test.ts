import { describe, it, expect, beforeEach, vi } from "vitest";
import { AiService } from "./ai.service";

describe("AiService", () => {
  let service: AiService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      tenantIslem: vi.fn((tenantId, cb) => cb(mockPrisma)),
      kasa: {
        findMany: vi.fn().mockResolvedValue([{ bakiye: 50000 }]),
      },
      bankaHesap: {
        findMany: vi.fn().mockResolvedValue([{ bakiye: 50000 }]),
      },
      fatura: {
        aggregate: vi.fn().mockImplementation(({ where }) => {
          if (where.tip === "satis") return Promise.resolve({ _sum: { genelToplam: 50000 } });
          return Promise.resolve({ _sum: { genelToplam: 20000 } });
        })
      }
    };

    service = new AiService(mockPrisma);
  });

  it("Görsel OCR taramasını başarmalıdır", async () => {
    const sonuc = await service.fisFaturaOcrTara("tenant-1", {
      gorselBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    });

    expect(sonuc.basarili).toBe(true);
    expect(sonuc.okunanVeriler.unvan).toBe("MİGROS TİCARET A.Ş.");
  });

  it("Nakit akış tahminini doğru risk seviyesiyle üretmelidir", async () => {
    const tahmin = await service.nakitAkisTahmini("tenant-1", { tarihAraligiGun: 30 });
    expect(tahmin.mevcutBakiye).toBe(100000);
    expect(tahmin.riskSeviyesi).toBe("DÜŞÜK_RİSK");
  });
});
