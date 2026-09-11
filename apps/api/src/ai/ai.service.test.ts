import { describe, it, expect, beforeEach, vi } from "vitest";
import { AiService } from "./ai.service";
import { NotImplementedException } from "@nestjs/common";

describe("AiService", () => {
  let service: AiService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = { tenantIslem: vi.fn((tenantId, cb) => cb(mockPrisma)) };
    service = new AiService(mockPrisma);
  });

  it("doğrulanmamış OCR özelliğini sahte sonuç üretmeden kapalı tutar", async () => {
    await expect(service.fisFaturaOcrTara("tenant-1", {
      gorselBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    })).rejects.toBeInstanceOf(NotImplementedException);
  });
});
