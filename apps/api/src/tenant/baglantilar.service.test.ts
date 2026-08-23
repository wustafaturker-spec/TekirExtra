import { describe, expect, it, afterEach } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { BaglantilarService } from "./baglantilar.service";

describe("BaglantilarService adapter güvenliği", () => {
  const onceki = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = onceki;
    delete process.env.ALLOW_MOCK_ENTEGRATIONS;
  });

  it("production ortamında gerçek adapter olmayan sağlayıcıyı engeller", () => {
    process.env.NODE_ENV = "production";
    const servis = new BaglantilarService({} as never);
    expect(() => servis.adapterCoz("foriba")).toThrow(BadRequestException);
  });

  it("geliştirme ortamında mock adapter kullanımını korur", () => {
    process.env.NODE_ENV = "development";
    const servis = new BaglantilarService({} as never);
    expect(servis.adapterCoz("foriba")).toBeDefined();
  });
});
