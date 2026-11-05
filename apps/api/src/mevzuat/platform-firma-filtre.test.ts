import { describe, expect, it, vi } from "vitest";
import { firmaFiltreSemasi } from "./platform-firma-filtre";
import { PlatformFirmaController } from "./platform.controller";

describe("sayfalı firma sorgusu", () => {
  it("varsayılanları uygular ve aramayı kırpar", () => {
    expect(firmaFiltreSemasi.parse({ arama: "  Örnek  " })).toMatchObject({ arama: "Örnek", sayfa: 1, sayfaBoyutu: 25, goster: "hepsi", siralama: "unvan" });
  });
  it.each([
    { sayfa: "0" }, { sayfa: "1.5" }, { sayfa: "100001" }, { sayfaBoyutu: "101" },
    { goster: "bilinmeyen" }, { siralama: "unvan; DROP TABLE tenants" }, { firma: "t1" },
    { arama: "x".repeat(201) }, { kayitBaslangic: "2026-02-30" },
    { kayitBaslangic: "2026-11-02", kayitBitis: "2026-11-01" },
    { yenilemeBaslangic: "2026-11-02", yenilemeBitis: "2026-11-01" },
    { plan: ["baslangic", "kurumsal"] },
  ])("geçersiz sorguyu veritabanına iletmez: %j", (sorgu) => {
    const servis = { sayfali: vi.fn() };
    const controller = new PlatformFirmaController(servis as never);
    expect(() => controller.sayfali(sorgu)).toThrow();
    expect(servis.sayfali).not.toHaveBeenCalled();
  });
});
