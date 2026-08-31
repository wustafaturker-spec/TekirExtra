import { HttpException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../core/prisma.service";
import { HealthController } from "./health.controller";

const eskiRedisUrl = process.env.REDIS_URL;
const eskiS3Endpoint = process.env.S3_ENDPOINT;

afterEach(() => {
  if (eskiRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = eskiRedisUrl;
  if (eskiS3Endpoint === undefined) delete process.env.S3_ENDPOINT;
  else process.env.S3_ENDPOINT = eskiS3Endpoint;
  vi.restoreAllMocks();
});

describe("HealthController", () => {
  it("liveness veritabanına dokunmadan sürecin ayakta olduğunu bildirir", () => {
    const sorgu = vi.fn().mockRejectedValue(new Error("veritabanı kapalı"));
    const controller = new HealthController({ $queryRaw: sorgu } as unknown as PrismaService);

    expect(controller.health()).toEqual(expect.objectContaining({ durum: "ok" }));
    expect(sorgu).not.toHaveBeenCalled();
  });

  it("readiness tüm yapılandırılmış bağımlılıklar erişilebilirse ready döner", async () => {
    process.env.REDIS_URL = "redis://redis:6379";
    process.env.S3_ENDPOINT = "http://minio:9000";
    const controller = new HealthController({ $queryRaw: vi.fn().mockResolvedValue([{ sonuc: 1 }]) } as unknown as PrismaService);
    vi.spyOn(controller as never, "tcpKontrol" as never).mockResolvedValue("ok" as never);

    await expect(controller.ready()).resolves.toEqual(expect.objectContaining({
      durum: "ready",
      bagimliliklar: { veritabani: "ok", redis: "ok", depo: "ok" },
    }));
  });

  it("readiness veritabanı erişilemiyorsa 503 ve bağımlılık durumunu döner", async () => {
    delete process.env.REDIS_URL;
    delete process.env.S3_ENDPOINT;
    const controller = new HealthController({ $queryRaw: vi.fn().mockRejectedValue(new Error("kapalı")) } as unknown as PrismaService);

    try {
      await controller.ready();
      throw new Error("503 bekleniyordu");
    } catch (hata) {
      expect(hata).toBeInstanceOf(HttpException);
      expect((hata as HttpException).getStatus()).toBe(503);
      expect((hata as HttpException).getResponse()).toEqual(expect.objectContaining({
        durum: "not_ready",
        bagimliliklar: { veritabani: "erisilemiyor" },
      }));
    }
  });
});
