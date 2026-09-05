import { describe, it, expect, beforeEach, vi } from "vitest";
import { AiService } from "./ai.service";
import { NotImplementedException } from "@nestjs/common";

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
        findMany: vi.fn().mockResolvedValue([
          { tip: "satis", genelToplam: 50000, kur: 1, kasaBankaHarekets: [{ tutarTry: 10000 }], krediKartiHareketleri: [] },
          { tip: "alis", genelToplam: 20000, kur: 1, kasaBankaHarekets: [{ tutarTry: 5000 }], krediKartiHareketleri: [] },
        ]),
      }
    };

    service = new AiService(mockPrisma);
  });

  it("doğrulanmamış OCR özelliğini sahte sonuç üretmeden kapalı tutar", async () => {
    await expect(service.fisFaturaOcrTara("tenant-1", {
      gorselBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    })).rejects.toBeInstanceOf(NotImplementedException);
  });

  it("Nakit akış tahminini doğru risk seviyesiyle üretmelidir", async () => {
    const tahmin = await service.nakitAkisTahmini("tenant-1", { tarihAraligiGun: 30 });
    expect(tahmin.mevcutBakiye).toBe(100000);
    expect(tahmin.riskSeviyesi).toBe("DÜŞÜK_RİSK");
    expect(tahmin.beklenenAlacaklar).toBe(40000);
    expect(tahmin.beklenenBorclar).toBe(15000);
    expect(tahmin.tahminiSonBakiye).toBe(125000);
    expect(mockPrisma.fatura.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vadeTarihi: expect.any(Object) }) }));
  });
});
