import { describe, expect, it, vi } from "vitest";
import { PlatformFirmaTakipController, firmaNotSemasi, firmaTakipSemasi } from "./platform-firma-takip.controller";

const id = "00000000-0000-4000-8000-000000000001";
const girdi = { sorumluId: null, durum: "acik", sonrakiGorusme: null, surum: 0 };
describe("firma takip doğrulaması", () => {
  it.each([{ ...girdi, surum: -1 }, { ...girdi, surum: 1.5 }, { ...girdi, sonrakiGorusme: "2026-02-30" }, { ...girdi, sorumluId: "t1" }, { ...girdi, durum: "silindi" }, { ...girdi, tenantId: id }])("geçersiz takip API'den servise geçmez: %j", (g) => {
    const service = { guncelle: vi.fn() };
    expect(() => new PlatformFirmaTakipController(service as never).guncelle(id, g)).toThrow();
    expect(service.guncelle).not.toHaveBeenCalled();
  });
  it("ilk kayıt ve geçerli artık gün kabul edilir", () => {
    expect(firmaTakipSemasi.parse({ ...girdi, sonrakiGorusme: "2028-02-29" }).surum).toBe(0);
  });
  it.each([{ metin: "   ", islemAnahtari: id }, { metin: "x".repeat(4001), islemAnahtari: id }, { metin: "Not", islemAnahtari: "yeniden-dene" }])("geçersiz iç not reddedilir: %j", (g) => {
    expect(firmaNotSemasi.safeParse(g).success).toBe(false);
  });
  it("notu kırpar, sayfalamayı doğrular", () => {
    expect(firmaNotSemasi.parse({ metin: " Not ", islemAnahtari: id }).metin).toBe("Not");
    const service = { notlar: vi.fn() };
    const c = new PlatformFirmaTakipController(service as never);
    expect(() => c.notlar(id, "0")).toThrow();
    expect(() => c.notlar(id, "100001")).toThrow();
    expect(service.notlar).not.toHaveBeenCalled();
  });
});
