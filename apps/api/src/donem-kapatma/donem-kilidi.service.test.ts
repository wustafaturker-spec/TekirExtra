import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { DonemKilidiService } from "./donem-kilidi.service";

describe("DonemKilidiService", () => {
  it("kapalı mali döneme tarihli mutasyonu reddeder", async () => {
    const prisma = { tenantIslem: vi.fn((_tenantId, cb) => cb({ maliDonem: { findUnique: vi.fn().mockResolvedValue({ durum: "kapali" }) } })) } as any;
    const service = new DonemKilidiService(prisma);
    await expect(service.tarihDogrula("tenant-1", new Date(2026, 7, 15), "fatura oluşturma")).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.tenantIslem).toHaveBeenCalledWith("tenant-1", expect.any(Function));
  });

  it("açık veya henüz oluşturulmamış döneme izin verir", async () => {
    const prisma = { tenantIslem: vi.fn((_tenantId, cb) => cb({ maliDonem: { findUnique: vi.fn().mockResolvedValue(null) } })) } as any;
    await expect(new DonemKilidiService(prisma).tarihDogrula("tenant-1", "2026-08-15", "hareket")).resolves.toBeUndefined();
  });
});
