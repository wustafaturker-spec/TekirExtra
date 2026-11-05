import { describe, expect, it, vi } from "vitest";
import { PlatformPaketController } from "./platform-paket.controller";
import { PlatformPaketService } from "./platform-paket.service";
import { platformBaglamiylaCalistir } from "../core/istek-baglami";

const veri = { kod: "yeni_paket", ad: "Paket", aciklama: "Açıklama", ozellikler: ["Özellik"], siralama: 10 };
const fiyat = { paraBirimi: "TRY", vergiDahil: false, kdvOrani: "20", gecerlilikTarihi: "2026-12-01", donemler: [{ aySayisi: 1, matrah: "399.00" }] };
describe("paket kataloğu sözleşmesi", () => {
  it("deneme gün sayısını doğrular; eski istemcinin düzenlemesinde süreyi sıfırlamaz", () => {
    const olustur = vi.fn(), guncelle = vi.fn(), c = new PlatformPaketController({ olustur, guncelle } as never);
    for (const denemeGunSayisi of [-1, 366, 1.5, "14", null]) {
      expect(() => c.olustur({ ...veri, denemeGunSayisi })).toThrow();
    }
    expect(olustur).not.toHaveBeenCalled();
    for (const denemeGunSayisi of [0, 14, 365]) {
      c.olustur({ ...veri, denemeGunSayisi });
      expect(olustur).toHaveBeenLastCalledWith({ ...veri, denemeGunSayisi });
    }
    const { kod: _kod, ...icerik } = veri;
    c.guncelle("id", "surum", { ...icerik, kilitSurumu: 1 });
    expect(guncelle).toHaveBeenLastCalledWith("id", "surum", { ...icerik, kilitSurumu: 1 });
  });
  it.each([
    { paraBirimi: "USD" }, { vergiDahil: true }, { kdvOrani: "101" }, { kdvOrani: 20 },
    { gecerlilikTarihi: "2026-02-30" }, { gecerlilikTarihi: "0000-01-01" }, { gecerlilikTarihi: "2026-12-01T00:00:00Z" },
    { donemler: [] }, { donemler: [{ aySayisi: 2, matrah: "10" }] },
    { donemler: [{ aySayisi: 1, matrah: "1.001" }] }, { donemler: [{ aySayisi: 1, matrah: 1 }] },
    { donemler: [fiyat.donemler[0], fiyat.donemler[0]] }, { satisAcik: true },
  ])("geçersiz sürüm fiyatı servise ulaşmaz: %j", (ek) => {
    const olustur = vi.fn(), c = new PlatformPaketController({ olustur } as never);
    expect(() => c.olustur({ ...veri, fiyatlandirma: { ...fiyat, ...ek } })).toThrow();
    expect(olustur).not.toHaveBeenCalled();
  });
  it("fiyat tanımlanabilir, kaldırılabilir veya eski istemcide gönderilmeyebilir", () => {
    const olustur = vi.fn(), c = new PlatformPaketController({ olustur } as never);
    for (const fiyatlandirma of [fiyat, null]) {
      c.olustur({ ...veri, fiyatlandirma }); expect(olustur).toHaveBeenLastCalledWith({ ...veri, fiyatlandirma });
    }
    c.olustur(veri); expect(olustur).toHaveBeenLastCalledWith(veri);
  });
  it.each([{ kod: "v1" }, { kod: "BASLANGIC" }, { kod: "a" }, { ad: " " }, { siralama: -1 }, { siralama: 1.5 }, { siralama: 10001 }, { ozellikler: [""] }, { ozellikler: Array(31).fill("Özellik") }, { ozellikler: ["x".repeat(201)] }, { aylikFiyat: 1 }, { satisEntegrasyonu: true }])("hatalı veya desteklenmeyen tanım servise ulaşmaz: %j", (ek) => {
    const olustur = vi.fn(), c = new PlatformPaketController({ olustur } as never);
    expect(() => c.olustur({ ...veri, ...ek })).toThrow(); expect(olustur).not.toHaveBeenCalled();
  });
  it("oluşturma ve düzenleme beyaz listeyi uygular; eski kilit zorunludur", () => {
    const olustur = vi.fn(), guncelle = vi.fn(); const c = new PlatformPaketController({ olustur, guncelle } as never);
    c.olustur({ ...veri, ad: " Paket " }); expect(olustur).toHaveBeenCalledWith(veri);
    const { kod: _kod, ...icerik } = veri;
    expect(() => c.guncelle("id", "surum", icerik)).toThrow();
    expect(() => c.guncelle("id", "surum", { ...icerik, kilitSurumu: 0 })).toThrow();
    c.guncelle("id", "surum", { ...icerik, kilitSurumu: 2 }); expect(guncelle).toHaveBeenCalledWith("id", "surum", { ...icerik, kilitSurumu: 2 });
  });
  it.each([{ sayfa: "0" }, { sayfa: "100001" }, { arama: "a".repeat(101) }, { durum: "hepsi" }])("liste sorgusu doğrulanır: %j", (g) => {
    const listele = vi.fn(); expect(() => new PlatformPaketController({ listele } as never).listele(g)).toThrow(); expect(listele).not.toHaveBeenCalled();
  });
  it("yayın ve arşiv yalnız revizyon alır; kopya sürüm kimliği zorunludur", () => {
    const yayinla = vi.fn(), arsivle = vi.fn(), taslakAc = vi.fn(); const c = new PlatformPaketController({ yayinla, arsivle, taslakAc } as never);
    expect(() => c.yayinla("id", "surum", { kilitSurumu: 1, ad: "Yeni ad" })).toThrow();
    expect(() => c.taslak("id", { kaynakSurumId: "yanlis" })).toThrow();
    c.yayinla("id", "surum", { kilitSurumu: 1 }); expect(yayinla).toHaveBeenCalledWith("id", "surum", 1);
    c.arsivle("id", "surum", { kilitSurumu: 2 }); expect(arsivle).toHaveBeenCalledWith("id", "surum", 2);
  });
  it("editör bütün servis yollarında veritabanına ulaşmadan reddedilir", async () => {
    const db = { $queryRaw: vi.fn(), $transaction: vi.fn() }, s = new PlatformPaketService({ db } as never);
    await platformBaglamiylaCalistir({ kullaniciId: "e1", eposta: "test@example.invalid", rol: "mevzuat_editoru" }, async () => {
      for (const is of [() => s.gecisDurumu(1), () => s.listele({ arama: "", sayfa: 1 }), () => s.getir("id"), () => s.olustur(veri), () => s.taslakAc("id", "s"), () => s.guncelle("id", "s", { ...veri, kilitSurumu: 1 }), () => s.yayinla("id", "s", 1), () => s.arsivle("id", "s", 1)]) {
        await expect(is()).rejects.toThrow("yöneticisi");
      }
    });
    expect(db.$transaction).not.toHaveBeenCalled(); expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
