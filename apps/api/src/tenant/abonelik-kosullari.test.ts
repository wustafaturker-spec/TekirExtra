import { describe, expect, it } from "vitest";
import { ABONELIK_PLANLARI } from "./abonelik-planlari";
import { abonelikKosullariniOku, abonelikModulleriniOku, bagliAbonelikTutari, etkinAbonelikPlani } from "./abonelik-kosullari";
import { ABONELIK_SURELERI, abonelikTutari } from "../abonelik-odeme/abonelik-tutari";
import { odemeFiyatFotografi } from "../abonelik-odeme/odeme-fiyat-fotografi";

const id = "00000000-0000-4000-8000-000000000001";
const kosul = () => ({ semaSurumu: 1, kaynak: "eski_plan_gecisi", planKodu: "baslangic", planAdi: "Korunan paket", limitler: { kullanici: 3, cari: 5, stok: 500, aylikFatura: 100 }, fiyatlandirma: { paraBirimi: "TRY", vergiDahil: false, kdvOrani: "10", donemler: [{ aySayisi: 1, matrah: "321.00" }, { aySayisi: 12, matrah: "3210.00" }] } });
const bag = () => ({ planKodu: "baslangic", paketSurumId: id, paketKosullari: kosul() });
describe("aboneliğin korunmuş paket koşulları", () => {
  it("kapsam koşullarında limitler ve modüller aynı sözleşmeden gelir; fiyat korunur", () => {
    const k = kosul();
    const paketKosullari = { ...k, semaSurumu: 2, kaynak: "katalog_atamasi", kapsamSozlesmesi: { semaSurumu: 1, moduller: ["cari"], kotalar: Object.fromEntries(Object.entries(k.limitler).map(([kod, sinir]) => [kod, { sinir, uyariYuzdesi: 80 }])) } };
    const a = { ...bag(), paketKosullari };
    expect(abonelikModulleriniOku(a)).toEqual(["cari"]);
    expect(bagliAbonelikTutari(a, 1)?.toplam.toFixed(2)).toBe("353.10");
    expect(() => abonelikKosullariniOku({ ...a, paketKosullari: { ...paketKosullari, limitler: { ...k.limitler, cari: 6 } } })).toThrow();
    expect(() => abonelikKosullariniOku({ ...a, paketKosullari: { ...paketKosullari, kaynak: "eski_plan_gecisi" } })).toThrow();
    expect(abonelikModulleriniOku(bag())).toBeNull();
  });
  it("kontrollü katalog atamasının fiyatını, limitini ve ödeme fotoğrafı kaynağını korur", () => {
    const a = { ...bag(), paketKosullari: { ...kosul(), kaynak: "katalog_atamasi" } };
    expect(etkinAbonelikPlani(a).limitler).toEqual(kosul().limitler);
    expect(odemeFiyatFotografi(bagliAbonelikTutari(a, 12)!)).toMatchObject({ semaSurumu: 2, kaynak: "katalog_atamasi", paketSurumId: id, toplam: "3531.00" });
  });
  it("fiyat ve limit için sabit kaynak yerine kayıtlı sözleşmeyi kullanır", () => {
    expect(etkinAbonelikPlani(bag())).toMatchObject({ ad: "Korunan paket", aylikFiyat: 321, limitler: { cari: 5 } });
    const t = bagliAbonelikTutari(bag(), 12)!;
    expect([t.matrah.toFixed(2), t.kdv.toFixed(2), t.toplam.toFixed(2)]).toEqual(["3210.00", "321.00", "3531.00"]);
    expect(odemeFiyatFotografi(t)).toMatchObject({ semaSurumu: 2, kaynak: "eski_plan_gecisi", paketSurumId: id, planAdi: "Korunan paket", kdvOrani: "10", toplam: "3531.00" });
    expect(bagliAbonelikTutari(bag(), 3)).toBeNull();
  });
  it.each(ABONELIK_PLANLARI)("eski $kod planı dört dönemde aynı tutar ve limite dönüşür", (p) => {
    const paketKosullari = { semaSurumu: 1, kaynak: "eski_plan_gecisi", planKodu: p.kod, planAdi: p.ad, limitler: p.limitler,
      fiyatlandirma: p.aylikFiyat === null ? null : { paraBirimi: "TRY", vergiDahil: false, kdvOrani: "20", donemler: ABONELIK_SURELERI.map((aySayisi) => ({ aySayisi, matrah: (p.aylikFiyat! * aySayisi).toFixed(2) })) } };
    const a = { planKodu: p.kod, paketSurumId: id, paketKosullari };
    expect(etkinAbonelikPlani(a).limitler).toEqual(p.limitler);
    for (const ay of ABONELIK_SURELERI) expect(bagliAbonelikTutari(a, ay)?.toplam.toFixed(2) ?? null).toBe(abonelikTutari(p.kod, ay)?.toplam.toFixed(2) ?? null);
    if (p.kod === "profesyonel") expect(bagliAbonelikTutari({ ...a, planKodu: "v1" }, 1)?.planKodu).toBe("profesyonel");
  });
  it.each([
    { paketSurumId: null }, { paketKosullari: null }, { paketSurumId: "yanlis" }, { planKodu: "kurumsal" },
    { paketKosullari: { ...kosul(), kaynak: "katalog_yayini" } },
    { paketKosullari: { ...kosul(), limitler: { ...kosul().limitler, cari: -1 } } },
    { paketKosullari: { ...kosul(), fiyatlandirma: { ...kosul().fiyatlandirma, kdvOrani: "101" } } },
  ])("bozuk veya yarım bağda eski fiyata düşmez: %j", (ek) => {
    expect(() => abonelikKosullariniOku({ ...bag(), ...ek })).toThrow();
  });
  it("aktarılmamış eski istemciyi korur; bilinmeyen plan fiyatını tahmin etmez", () => {
    expect(bagliAbonelikTutari({ planKodu: "v1" }, 1)?.toplam.toFixed(2)).toBe("1198.80");
    expect(bagliAbonelikTutari({ planKodu: "bilinmeyen" }, 1)).toBeNull();
  });
});
