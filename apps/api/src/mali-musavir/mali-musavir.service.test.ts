import { describe, it, expect, beforeEach, vi } from "vitest";
import { MaliMusavirService } from "./mali-musavir.service";

describe("MaliMusavirService", () => {
  let service: MaliMusavirService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      tenantIslem: vi.fn((tenantId, cb) => cb(mockPrisma)),
      fatura: {
        findMany: vi.fn().mockResolvedValue([
          {
            no: "FTR2026000000001",
            tarih: new Date("2026-08-01"),
            tip: "satis",
            toplamMatrah: 1000,
            toplamKdv: 200,
            genelToplam: 1200,
            durum: "kesin",
            cari: { unvan: "Test Müşteri", vknTckn: "11111111111" },
            satirlar: []
          }
        ]),
      },
      kasaBankaHareket: {
        findMany: vi.fn().mockResolvedValue([]),
      }
    };

    service = new MaliMusavirService(mockPrisma);
  });

  it("Luca XML aktarımını doğru şablon ile üretmelidir", async () => {
    const xml = await service.lucaFaturaXmlAktar("tenant-1", new Date("2026-08-01"), new Date("2026-08-31"));
    expect(xml).toContain("<LucaAktarim>");
    expect(xml).toContain("<No>FTR2026000000001</No>");
    expect(xml).toContain("<CariUnvan>Test Müşteri</CariUnvan>");
  });

  it("KDV Özet Raporunu doğru hesaplamalıdır", async () => {
    const ozet = await service.kdvOzetRaporu("tenant-1", new Date("2026-08-01"), new Date("2026-08-31"));
    expect(ozet.hesaplananKdv).toBe(200);
    expect(ozet.indirilecekKdv).toBe(0);
    expect(ozet.odenecekKdv).toBe(200);
  });
});
