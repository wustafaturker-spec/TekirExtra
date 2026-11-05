import { describe, expect, it, vi } from "vitest";
import { PlatformIstatistikController } from "./platform-istatistik.controller";
import { aralikDogrula, istatistikFiltreSemasi } from "./platform-istatistik-filtre";
import { PlatformIstatistikService } from "./platform-istatistik.service";
import { platformBaglamiylaCalistir } from "../core/istek-baglami";

describe("firma istatistik sözleşmesi", () => {
  it.each([{ operasyonGun: "2026-02-30" }, { operasyonGecmisSayfa: "0" }, { operasyonGecmisSayfa: "100001" }, { baslamaDurum: "DROP" }, { baslamaSayfa: "0" }, { operasyon: "redis" }, { operasyonSayfa: "100001" }])("başlama/operasyon filtresi doğrulanır: %j", (ek) => {
    const service = { rapor: vi.fn() };
    expect(() => new PlatformIstatistikController(service as never).rapor({ baslangic: "2026-01-01", bitis: "2026-01-02", ...ek })).toThrow();
    expect(service.rapor).not.toHaveBeenCalled();
  });
  it.each([{ baslangic: "2026-02-30", bitis: "2026-03-01" }, { baslangic: "2026-01-01", bitis: "2026-01-02", sayfa: "0" }, { baslangic: "2026-01-01", bitis: "2026-01-02", olcut: "DROP" }, { baslangic: "2026-01-01", bitis: "2026-01-02", firma: "t1" }, { baslangic: "2026-01-01", bitis: "2026-01-02", plan: "x".repeat(41) }])("hatalı filtre servise ulaşmaz: %j", (f) => {
    const service = { rapor: vi.fn() };
    expect(() => new PlatformIstatistikController(service as never).rapor(f)).toThrow();
    expect(service.rapor).not.toHaveBeenCalled();
  });
  it("önceki dönemi eşit gün sayısıyla hesaplar, sınır ve gelecek tarihleri reddeder", () => {
    expect(aralikDogrula("2024-02-28", "2024-03-01")).toEqual({ adet: 3, oncekiBaslangic: "2024-02-25", oncekiBitis: "2024-02-27" });
    for (const [bas, bit] of [["2026-02-01", "2026-01-01"], ["2025-01-01", "2025-12-31"], ["9999-01-01", "9999-01-01"], ["0001-01-01", "0001-01-01"]]) expect(() => aralikDogrula(bas, bit)).toThrow();
    expect(() => aralikDogrula("2025-01-01", "2025-02-01", 31)).toThrow();
  });
  it("editör rapor ve yeniden hesaplamada veritabanına ulaşamaz", async () => {
    const db = { $transaction: vi.fn(), $queryRaw: vi.fn() };
    const s = new PlatformIstatistikService({ db } as never);
    const f = istatistikFiltreSemasi.parse({ baslangic: "2026-01-01", bitis: "2026-01-01" });
    await platformBaglamiylaCalistir({ kullaniciId: "p1", eposta: "test@ornek.invalid", rol: "mevzuat_editoru" }, async () => {
      await expect(s.rapor(f)).rejects.toThrow("yöneticisi yetkisi");
      await expect(s.yenidenHesapla(f.baslangic, f.bitis)).rejects.toThrow("yöneticisi yetkisi");
    });
    expect(db.$transaction).not.toHaveBeenCalled(); expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
