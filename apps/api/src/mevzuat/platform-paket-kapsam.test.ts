import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PAKET_MODUL_KODLARI } from "@tekirextra/shared";
import { PlatformPaketController } from "./platform-paket.controller";
import { atamaHatasiniCevir } from "./platform-paket-atama";

const veri = { kod: "kapsam_paketi", ad: "Paket", aciklama: "", ozellikler: ["Tanım"], siralama: 1 };
const kapsam = () => ({ semaSurumu: 1, moduller: [...PAKET_MODUL_KODLARI], kotalar: {
  kullanici: { sinir: 0, uyariYuzdesi: 80 }, cari: { sinir: null, uyariYuzdesi: 99 }, stok: { sinir: 100, uyariYuzdesi: 1 }, aylikFatura: { sinir: 200, uyariYuzdesi: 80 },
} });
describe("katalog kapsamı API sözleşmesi", () => {
  it("sıfır, sınırsız ve uyarı eşiklerini değiştirmeden kabul eder", () => {
    const olustur = vi.fn(), c = new PlatformPaketController({ olustur } as never);
    c.olustur({ ...veri, kapsamSozlesmesi: kapsam() }); expect(olustur).toHaveBeenCalledWith({ ...veri, kapsamSozlesmesi: kapsam() });
  });
  it("eski istemcinin göndermediği alanı eklemez; açık null kaldırma isteğidir", () => {
    const olustur = vi.fn(), c = new PlatformPaketController({ olustur } as never);
    c.olustur(veri); expect(olustur).toHaveBeenLastCalledWith(veri);
    c.olustur({ ...veri, kapsamSozlesmesi: null }); expect(olustur).toHaveBeenLastCalledWith({ ...veri, kapsamSozlesmesi: null });
  });
  it.each([{ moduller: ["ebelge"] }, { moduller: ["ayarlar"] }, { moduller: ["cari", "cari"] }, { moduller: [] }, { semaSurumu: 2 }, { ekUcret: 1 }, { kotalar: {} }])("geçersiz kapsam servise ulaşmaz: %j", (ek) => {
    const olustur = vi.fn(), c = new PlatformPaketController({ olustur } as never);
    expect(() => c.olustur({ ...veri, kapsamSozlesmesi: { ...kapsam(), ...ek } })).toThrow(); expect(olustur).not.toHaveBeenCalled();
  });
  it("kapsam atama engelini anlaşılır 400 hatasına çevirir", () => {
    expect(() => atamaHatasiniCevir({ meta: { message: "atama_kapsam_desteklenmiyor" } })).toThrow(BadRequestException);
    expect(() => atamaHatasiniCevir({ meta: { message: "atama_kapsam_desteklenmiyor" } })).toThrow("Kapsam ataması");
  });
});
