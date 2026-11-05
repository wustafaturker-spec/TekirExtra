import { describe, expect, it } from "vitest";
import { PAKET_MODUL_KODLARI, PAKET_MODUL_ADLARI, PAKET_KOTA_KODLARI, paketKapsamSemasi, paketKotaAyi, paketKotaDurumu, paketApiYoluKapali, paketPanelYoluKapali } from "./paket-kapsami";
import { YETKI_MODULLERI } from "./yetki-modulleri";

const kapsam = () => ({ semaSurumu: 1, moduller: [...PAKET_MODUL_KODLARI], kotalar: Object.fromEntries(PAKET_KOTA_KODLARI.map((kod) => [kod, { sinir: 10, uyariYuzdesi: 80 }])) });
describe("paketin yol erişimi", () => {
  it("satışa bağlı AI ucu hem satış hem yapay zekâ kapsamını gerektirir", () => {
    expect(paketApiYoluKapali(["satis"], "/ai/teklif-talepleri")).toBe(true);
    expect(paketApiYoluKapali(["yapay_zeka"], "/ai/teklif-talepleri")).toBe(true);
    expect(paketApiYoluKapali(["satis", "yapay_zeka"], "/ai/teklif-talepleri")).toBe(false);
    expect(paketApiYoluKapali(["cari"], "/cari/vade-hatirlatma/ai-not")).toBe(true);
    expect(paketApiYoluKapali(["ebelge"], "/ebelge/gelen/1/ai")).toBe(true);
    expect(paketApiYoluKapali(["ebelge", "yapay_zeka"], "/ebelge/gelen/1/ai")).toBe(false);
  });
  it("eski abonelikte tüm modülleri korur; kapsam varsa API ve paneli kapatır", () => {
    expect(paketApiYoluKapali(null, "/stok/1")).toBe(false);
    expect(paketApiYoluKapali(["cari"], "/stok/1")).toBe(true);
    expect(paketApiYoluKapali(["cari"], "/cari/1")).toBe(false);
    expect(paketPanelYoluKapali(["cari"], "/panel/stok")).toBe(true);
    expect(paketPanelYoluKapali(["cari"], "/panel/ayarlar/abonelik")).toBe(false);
  });
  it("self servis ve bayi alt yolları bağlı modülü gerektirir", () => {
    expect(paketApiYoluKapali(["cari"], "/self-servis/bordro")).toBe(true);
    expect(paketApiYoluKapali(["personel"], "/self-servis/bordro")).toBe(false);
    expect(paketPanelYoluKapali(["cari"], "/panel/b2b/siparisler")).toBe(true);
    expect(paketPanelYoluKapali(["satis"], "/panel/b2b/siparisler")).toBe(false);
    expect(paketApiYoluKapali([], "/auth/ben")).toBe(false);
  });
});
describe("paket modül ve kota sözleşmesi", () => {
  it("ortak rol modüllerini kullanır; hesap/abonelik ayarları seçime kapatılamaz", () => {
    expect(PAKET_MODUL_KODLARI).toEqual(YETKI_MODULLERI.filter((m) => m.kod !== "ayarlar").map((m) => m.kod));
    expect(Object.values(PAKET_MODUL_ADLARI).every(Boolean)).toBe(true);
    expect(paketKapsamSemasi.parse(kapsam()).moduller).toHaveLength(17);
  });
  it.each([[], ["ayarlar"], ["yeni"], ["cari", "cari"], ["fatura"], ["ebelge", "cari"], ["ebelge", "fatura"], ["uretim"]])("geçersiz/bağımlılığı eksik modülleri reddeder: %j", (moduller) => {
    expect(paketKapsamSemasi.safeParse({ ...kapsam(), moduller }).success).toBe(false);
  });
  it.each([null, 0, 1, 2147483647])("sınırsız ve tam sayı sınırını korur: %s", (sinir) => {
    const k = kapsam();
    expect(paketKapsamSemasi.parse({ ...k, kotalar: { ...k.kotalar, cari: { sinir, uyariYuzdesi: 80 } } }).kotalar.cari.sinir).toBe(sinir);
  });
  it.each([-1, 1.5, 2147483648, "10", undefined, NaN, Infinity])("hatalı kota sınırını reddeder: %s", (sinir) => {
    const k = kapsam(); expect(paketKapsamSemasi.safeParse({ ...k, kotalar: { ...k.kotalar, cari: { sinir, uyariYuzdesi: 80 } } }).success).toBe(false);
  });
  it.each([0, 100, 1.5, "80", undefined])("hatalı uyarı eşiğini reddeder: %s", (uyariYuzdesi) => {
    const k = kapsam(); expect(paketKapsamSemasi.safeParse({ ...k, kotalar: { ...k.kotalar, cari: { sinir: 10, uyariYuzdesi } } }).success).toBe(false);
  });
  it("eksik kota ve desteklenmeyen birim/ek ücret/özellik alanını reddeder", () => {
    const k = kapsam(), { cari: _cari, ...eksik } = k.kotalar;
    for (const g of [{ ...k, kotalar: eksik }, { ...k, ekUcret: 1 }, { ...k, kotalar: { ...k.kotalar, sube: { sinir: 2, uyariYuzdesi: 80 } } }, { ...k, kotalar: { ...k.kotalar, cari: { ...k.kotalar.cari, birim: "bayt" } } }]) expect(paketKapsamSemasi.safeParse(g).success).toBe(false);
  });
});
describe("ortak kota hesapları", () => {
  it.each([[0, 0, "dolu"], [1, 0, "asim"], [0, null, "sinirsiz"], [7, 10, "normal"], [8, 10, "uyari"], [10, 10, "dolu"], [11, 10, "asim"]] as const)("%s/%s kullanımını %s olarak değerlendirir", (kullanim, sinir, durum) => {
    expect(paketKotaDurumu(kullanim, sinir).durum).toBe(durum);
  });
  it("eşik ve kalanı yuvarlamayla erken aşım üretmeden hesaplar", () => {
    expect(paketKotaDurumu(2, 3, 80)).toMatchObject({ durum: "normal", kalan: 1 });
    expect(paketKotaDurumu(2147483646, 2147483647, 99).durum).toBe("uyari");
    expect(() => paketKotaDurumu(-1, 3)).toThrow(); expect(() => paketKotaDurumu(1.5, 3)).toThrow();
  });
  it.each([
    ["2026-10-31T20:59:59Z", "2026-09-30T21:00:00.000Z", "2026-10-31T21:00:00.000Z"],
    ["2026-10-31T21:00:00Z", "2026-10-31T21:00:00.000Z", "2026-11-30T21:00:00.000Z"],
    ["2026-12-31T21:00:00Z", "2026-12-31T21:00:00.000Z", "2027-01-31T21:00:00.000Z"],
    ["2028-02-10T00:00:00Z", "2028-01-31T21:00:00.000Z", "2028-02-29T21:00:00.000Z"],
  ])("Türkiye ay sınırını doğru bulur: %s", (an, ilk, son) => {
    const r = paketKotaAyi(new Date(an)); expect(r.baslangic.toISOString()).toBe(ilk); expect(r.bitis.toISOString()).toBe(son);
  });
});
