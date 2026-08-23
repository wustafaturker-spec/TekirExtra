import { describe, it, expect, beforeEach, vi } from "vitest";
import { CrmFirsatService } from "./crm-firsat.service";

describe("CrmFirsatService", () => {
  let service: CrmFirsatService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      tenantIslem: vi.fn((tenantId, cb) => cb(mockPrisma)),
      crmFirsat: {
        findMany: vi.fn().mockResolvedValue([
          { id: "f-1", baslik: "Yazılım Projesi Satışı", asama: "yeni_lead", tahminiTutar: 150000 }
        ]),
        findFirst: vi.fn().mockResolvedValue({ id: "f-1", baslik: "Yazılım Projesi Satışı", asama: "yeni_lead" }),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "f-1", ...data })),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "f-1", ...data })),
      }
    };

    service = new CrmFirsatService(mockPrisma);
  });

  it("CRM fırsatlarını listelemelidir", async () => {
    const sonuc = await service.listele("tenant-1");
    expect(sonuc).toHaveLength(1);
    expect(sonuc[0].baslik).toBe("Yazılım Projesi Satışı");
  });

  it("Fırsatın aşamasını başarıyla güncelemelidir", async () => {
    const guncel = await service.asamaDegistir("tenant-1", "f-1", { asama: "kazanildi" });
    expect(mockPrisma.crmFirsat.update).toHaveBeenCalled();
    expect(guncel.asama).toBe("kazanildi");
  });
});
