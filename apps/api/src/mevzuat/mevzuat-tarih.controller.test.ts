import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AyarlarService } from "../core/ayarlar/ayarlar.service";
import { MevzuatController } from "./mevzuat.controller";
import type { MevzuatService } from "./mevzuat.service";
import { PlatformMevzuatController } from "./platform.controller";
import type { PlatformMevzuatService } from "./platform-mevzuat.service";

/** PLT-29: mevzuat tarihleri gerçek takvim günü olmalı; 2026-02-31 sessizce 3 Mart'a taşınmaz. */
const gecersiz = ["2026-02-31", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10"];
const govde = (yururlukBaslangic: string) => ({ baslik: "Asgari ücret 2027", dayanak: "Asgari Ücret Tespit Komisyonu kararı", yururlukBaslangic });

function platform() {
  const servis = { olustur: vi.fn(async () => ({ id: "d1" })), guncelle: vi.fn(async () => undefined), getir: vi.fn(async () => ({ id: "d1" })), kayitlar: vi.fn(async () => []) };
  return { servis, c: new PlatformMevzuatController(servis as unknown as PlatformMevzuatService) };
}

describe("PLT-29 — platform mevzuat tarihleri", () => {
  it("olmayan yürürlük gününü oluşturma ve güncellemede 400 ile reddeder, servise ulaştırmaz", async () => {
    const { servis, c } = platform();
    for (const g of gecersiz) {
      expect(() => c.olustur(govde(g))).toThrow(BadRequestException);
      await expect(c.guncelle("d1", govde(g))).rejects.toThrow("geçerli bir takvim günü");
    }
    expect(servis.olustur).not.toHaveBeenCalled();
    expect(servis.guncelle).not.toHaveBeenCalled();
  });

  it("geçerli günü (artık yıl dahil) değiştirmeden geçirir", async () => {
    const { servis, c } = platform();
    await c.olustur(govde("2028-02-29"));
    await c.guncelle("d1", govde("2027-01-01"));
    expect(servis.olustur).toHaveBeenCalledWith(expect.objectContaining({ yururlukBaslangic: "2028-02-29" }));
    expect(servis.guncelle).toHaveBeenCalledWith("d1", expect.objectContaining({ yururlukBaslangic: "2027-01-01" }));
  });

  it("kayıt sorgusunun tarih parametresini de denetler", async () => {
    const { servis, c } = platform();
    expect(() => c.kayitlar("kanuni_deger", "2026-02-31")).toThrow(BadRequestException);
    await c.kayitlar("kanuni_deger", "2026-02-28");
    expect(servis.kayitlar).toHaveBeenCalledWith("kanuni_deger", "2026-02-28", undefined);
  });
});

describe("PLT-29 — kiracı mevzuat okuma uçları", () => {
  const servis = { kodTablosu: vi.fn(async () => ({})), yururluktekiler: vi.fn(async () => []) };
  const c = new MevzuatController(servis as unknown as MevzuatService, {} as AyarlarService);

  it("kod tablosu, tevkifat tablosu ve kayıtlar olmayan günü reddeder", async () => {
    for (const g of gecersiz) {
      expect(() => c.kodTablosu(g)).toThrow(BadRequestException);
      expect(() => c.tevkifatTablosu(g)).toThrow(BadRequestException);
      await expect(c.kayitlar("kanuni_deger", g)).rejects.toThrow(BadRequestException);
    }
    expect(servis.kodTablosu).not.toHaveBeenCalled();
    expect(servis.yururluktekiler).not.toHaveBeenCalled();
  });

  it("geçerli günü servise aynen iletir", async () => {
    await c.kodTablosu("2026-10-31");
    await c.kayitlar("kanuni_deger", "2028-02-29");
    expect(servis.kodTablosu).toHaveBeenCalledWith("2026-10-31");
    expect(servis.yururluktekiler).toHaveBeenCalledWith("kanuni_deger", "2028-02-29");
  });
});
