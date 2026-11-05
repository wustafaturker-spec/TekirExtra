import { describe, expect, it, vi } from "vitest";
import { PlatformPaketController } from "./platform-paket.controller";
import { PlatformPaketService } from "./platform-paket.service";
import { platformBaglamiylaCalistir } from "../core/istek-baglami";

const id = "00000000-0000-4000-8000-000000000001";
const veri = { acik: true, surumId: id, kilitSurumu: 1, surumKilitSurumu: 2, neden: "Yeni satış sürümü" };
describe("katalog satış sözleşmesi", () => {
  it.each([{ acik: "true" }, { surumId: null }, { surumId: "yanlis" }, { surumKilitSurumu: null }, { kilitSurumu: 0 }, { kilitSurumu: 1.5 }, { neden: "kısa" }, { neden: "x".repeat(1001) }, { fiyat: 1 }, { acik: false }])("geçersiz onay servise ulaşmaz: %j", (ek) => {
    const satisDegistir = vi.fn(), c = new PlatformPaketController({ satisDegistir } as never);
    expect(() => c.satisDegistir(id, { ...veri, ...ek })).toThrow(); expect(satisDegistir).not.toHaveBeenCalled();
  });
  it("açma ve durdurma farklı hedef kuralları kullanır; gerekçe kırpılır", () => {
    const satisDegistir = vi.fn(), c = new PlatformPaketController({ satisDegistir } as never);
    c.satisDegistir(id, { ...veri, neden: "  Yeni satış sürümü  " });
    expect(satisDegistir).toHaveBeenLastCalledWith(id, veri);
    const kapat = { ...veri, acik: false, surumId: null, surumKilitSurumu: null };
    c.satisDegistir(id, kapat); expect(satisDegistir).toHaveBeenLastCalledWith(id, kapat);
  });
  it("geçmiş sayfası doğrulanır ve varsayılan birinci sayfadır", () => {
    const satisGetir = vi.fn(), c = new PlatformPaketController({ satisGetir } as never);
    c.satisGetir(id); expect(satisGetir).toHaveBeenCalledWith(id, 1);
    for (const p of ["0", "1.5", "100001", "abc"]) expect(() => c.satisGetir(id, p)).toThrow();
  });
  it("editör satış okuma/yazmasına erişemez", async () => {
    const db = { $transaction: vi.fn() }, s = new PlatformPaketService({ db } as never);
    await platformBaglamiylaCalistir({ kullaniciId: id, eposta: "editor@invalid.test", rol: "mevzuat_editoru" }, async () => {
      await expect(s.satisGetir(id)).rejects.toThrow("platform yöneticisi");
      await expect(s.satisDegistir(id, veri)).rejects.toThrow("platform yöneticisi");
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("yalnız bilinen iş hataları çevrilir; altyapı hatası korunur", async () => {
    const hata = new Error("veritabanı bağlantısı"), db = { $transaction: vi.fn().mockRejectedValue(hata) }, s = new PlatformPaketService({ db } as never);
    await platformBaglamiylaCalistir({ kullaniciId: id, eposta: "admin@invalid.test", rol: "yonetici" }, async () => {
      await expect(s.satisDegistir(id, veri)).rejects.toBe(hata);
      for (const [kod, mesaj] of [["satis_kilit", "yeniden onaylayın"], ["satis_hazir_degil", "fiyat ve kapsam"], ["satis_fiyat_tarihi", "henüz gelmedi"], ["satis_yetki", "Aktif platform"], ["satis_surum_yok", "hedef sürüm"]]) {
        db.$transaction.mockRejectedValueOnce({ meta: { message: kod } });
        await expect(s.satisDegistir(id, veri)).rejects.toThrow(mesaj);
      }
    });
  });
});
