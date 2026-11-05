import { describe, expect, it, vi } from "vitest";
import { ConflictException } from "@nestjs/common";
import { PlatformPaketController } from "./platform-paket.controller";
import { PlatformPaketService } from "./platform-paket.service";
import { atamaHatasiniCevir } from "./platform-paket-atama";
import { platformBaglamiylaCalistir } from "../core/istek-baglami";

const id = "00000000-0000-4000-8000-000000000001";
const girdi = { surumId: id, tenantIds: [id], uygulamaTarihi: "2026-11-04", neden: "Fiyat güncelleme" };
describe("paket atama sözleşmesi", () => {
  it.each([{ tenantIds: [] }, { tenantIds: [id, id] }, { tenantIds: Array(26).fill(id) }, { tenantIds: ["yanlis"] },
    { surumId: "yanlis" }, { uygulamaTarihi: "2026-02-30" }, { uygulamaTarihi: "0000-01-01" }, { neden: "   " }, { neden: "x".repeat(1001) }, { fiyatlandirma: {} }])("geçersiz istek servise ulaşmaz: %j", (ek) => {
    const atamaOnizle = vi.fn();
    expect(() => new PlatformPaketController({ atamaOnizle } as never).atamaOnizle({ ...girdi, ...ek })).toThrow();
    expect(atamaOnizle).not.toHaveBeenCalled();
  });
  it("neden temizlenir ve onay yalnız önizleme kimliği alır", () => {
    const atamaOnizle = vi.fn(), atamaUygula = vi.fn();
    const c = new PlatformPaketController({ atamaOnizle, atamaUygula } as never);
    c.atamaOnizle({ ...girdi, neden: ` ${girdi.neden} ` });
    expect(atamaOnizle).toHaveBeenCalledWith(girdi);
    expect(() => c.atamaUygula({ onizlemeId: id, tenantIds: [id] })).toThrow();
    expect(() => c.atamaUygula({ onizlemeId: "yanlis" })).toThrow();
    c.atamaUygula({ onizlemeId: id });
    expect(atamaUygula).toHaveBeenCalledWith(id);
  });
  it("editör veritabanına ulaşmadan reddedilir", async () => {
    const db = { $transaction: vi.fn() }, s = new PlatformPaketService({ db } as never);
    await platformBaglamiylaCalistir({ kullaniciId: id, eposta: "test@example.invalid", rol: "mevzuat_editoru" }, async () => {
      await expect(s.atamaOnizle(girdi)).rejects.toThrow("yöneticisi");
      await expect(s.atamaUygula(id)).rejects.toThrow("yöneticisi");
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it.each(["atama_kaynak_degisti", "atama_hedef_degisti", "atama_onizleme_suresi_doldu"])("yeniden önizleme gerektiren hata 409 olur: %s", (kod) => {
    expect(() => atamaHatasiniCevir({ meta: { message: kod } })).toThrow(ConflictException);
  });
  it("tanınmayan veritabanı hatasını aynen korur", () => {
    const hata = new Error("bağlantı kesildi");
    expect(() => atamaHatasiniCevir(hata)).toThrow(hata);
  });
  it("dönem sonunu tek firma/boş tarihle kabul eder; yanlış kombinasyonları reddeder", () => {
    const atamaOnizle = vi.fn(), c = new PlatformPaketController({ atamaOnizle } as never);
    c.atamaOnizle({ ...girdi, uygulamaTuru: "donem_sonu", uygulamaTarihi: null });
    expect(atamaOnizle).toHaveBeenCalledWith({ ...girdi, uygulamaTuru: "donem_sonu", uygulamaTarihi: null });
    for (const ek of [{ uygulamaTuru: "donem_sonu" }, { uygulamaTuru: "tarih", uygulamaTarihi: null }, { uygulamaTuru: "yanlis" }, { uygulamaTuru: "donem_sonu", uygulamaTarihi: null, tenantIds: [id, "00000000-0000-4000-8000-000000000002"] }]) expect(() => c.atamaOnizle({ ...girdi, ...ek })).toThrow();
  });
  it("plan listesi ve iptal beyaz listeyi doğrular", () => {
    const planliAtamalar = vi.fn(), planIptal = vi.fn(), c = new PlatformPaketController({ planliAtamalar, planIptal } as never);
    expect(() => c.planliAtamalar({ sayfa: "0" })).toThrow();
    expect(() => c.planliAtamalar({ surumId: "yanlis" })).toThrow();
    expect(() => c.planIptal(id, { neden: " " })).toThrow();
    expect(() => c.planIptal(id, { neden: "Geçerli neden", uygula: true })).toThrow();
    c.planliAtamalar({}); expect(planliAtamalar).toHaveBeenCalledWith({ sayfa: 1 });
    c.planIptal(id, { neden: " Geçerli neden " }); expect(planIptal).toHaveBeenCalledWith(id, "Geçerli neden");
  });
});
