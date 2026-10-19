import { describe, expect, it } from "vitest";
import { odemeSozuOzetiniHesapla, sozOzetTutariBicimi } from "./odeme-sozu-ozeti";
import type { OdemeSozu, OdemeSozuListesi } from "./odeme-sozu";
const cariId = "11111111-1111-4111-8111-111111111111";
const uuid = (n: number) => `22222222-2222-4222-8222-${n.toString().padStart(12, "0")}`;
function soz(n: number, fark: Partial<OdemeSozu> = {}): OdemeSozu {
  return { id: uuid(n), cariId, faturaId: uuid(n + 2000), faturaNo: null, dovizCinsi: "TRY", tutar: "1000.00", sozTarihi: "2026-10-20", verildigiZaman: "2026-10-14T10:00:00Z", aciklama: "Sentetik söz", kayitDurumu: "aktif", sonlandirmaNedeni: null, surum: 1, oncekiSozId: null,
    gerceklesme: { sozId: uuid(n), durum: "kismen_gerceklesti", gerceklesen: "400.00", kalan: "600.00" }, ...fark };
}
const liste = (...sozler: OdemeSozu[]): OdemeSozuListesi => ({ cari: { id: cariId, unvan: "Test" }, kullanimModu: "salt_okunur", alindigiZaman: "2026-10-18T12:00:00Z", zamanHassasiyeti: "gun", uyari: "Gün hassasiyeti", sozler });
const ozet = (v: OdemeSozuListesi) => odemeSozuOzetiniHesapla(v, cariId);
describe("Cari ödeme sözü özeti", () => {
  it("boş kaynağın kapsamını korur", () => expect(ozet(liste())).toMatchObject({ toplam: 0, aktif: 0, iptal: 0, revize: 0, kaynakGecersiz: 0, geciken: 0, bugun: "2026-10-18", dovizler: [] }));
  it("dövizleri ayrı toplar", () => {
    expect(ozet(liste(soz(1), soz(2, { dovizCinsi: "USD" }), soz(3)))).toMatchObject({ toplam: 3, aktif: 3, kismenGerceklesen: 3, dovizler: [
      { dovizCinsi: "TRY", aktifSoz: 2, sozTutari: "2000.00", gerceklesen: "800.00", kalan: "1200.00", gecikenKalan: "0.00" },
      { dovizCinsi: "USD", aktifSoz: 1, sozTutari: "1000.00", gerceklesen: "400.00", kalan: "600.00" },
    ] });
  });
  it("iptal/revizyon geçmişini sayar, tutarını yeni söze eklemez", () => {
    const eski = soz(1, { kayitDurumu: "revize", gerceklesme: { sozId: uuid(1), durum: "revize", gerceklesen: "0.00", kalan: "1000.00" } });
    const yeni = soz(2, { faturaId: eski.faturaId, oncekiSozId: eski.id });
    const iptal = soz(3, { kayitDurumu: "iptal", gerceklesme: { sozId: uuid(3), durum: "iptal", gerceklesen: "0.00", kalan: "1000.00" } });
    expect(ozet(liste(eski, yeni, iptal))).toMatchObject({ toplam: 3, aktif: 1, revize: 1, iptal: 1, dovizler: [{ aktifSoz: 1, sozTutari: "1000.00" }] });
  });
  it("geçersiz faturayı ayırır, kalanını toplama katmaz", () => {
    expect(ozet(liste(soz(1, { gerceklesme: { sozId: uuid(1), durum: "kaynak_gecersiz", gerceklesen: "0.00", kalan: "1000.00" } })))).toMatchObject({ aktif: 1, kaynakGecersiz: 1, geciken: 0, dovizler: [] });
  });
  it("snapshot Türkiye gününü kullanır, bugünkü sözü geciktirmez", () => {
    const v = liste(soz(1, { sozTarihi: "2026-10-18", gerceklesme: { sozId: uuid(1), durum: "gecikti", gerceklesen: "400.00", kalan: "600.00" } }), soz(2, { sozTarihi: "2026-10-19" }));
    v.alindigiZaman = "2026-10-18T21:00:00Z";
    expect(ozet(v)).toMatchObject({ bugun: "2026-10-19", geciken: 1, dovizler: [{ gecikenKalan: "600.00" }] });
  });
  it("tam gerçekleşmiş geçmiş vadede gecikmiş kalan üretmez", () => {
    expect(ozet(liste(soz(1, { sozTarihi: "2026-10-17", gerceklesme: { sozId: uuid(1), durum: "gerceklesti", gerceklesen: "1000.00", kalan: "0.00" } })))).toMatchObject({ tamamenGerceklesen: 1, geciken: 0, dovizler: [{ kalan: "0.00", gecikenKalan: "0.00" }] });
  });
  it("ödeme geri alınınca güncel gerçekleşme azalır", () => {
    expect(ozet(liste(soz(1, { gerceklesme: { sozId: uuid(1), durum: "gerceklesti", gerceklesen: "1000.00", kalan: "0.00" } }))).tamamenGerceklesen).toBe(1);
    expect(ozet(liste(soz(1)))).toMatchObject({ tamamenGerceklesen: 0, kismenGerceklesen: 1, dovizler: [{ gerceklesen: "400.00", kalan: "600.00" }] });
  });
  it("bin büyük sözün kuruşlarını Number sınırından sonra da korur", () => {
    const v = liste(...Array.from({ length: 1000 }, (_, i) => soz(i + 1, { tutar: "9999999999999.99", gerceklesme: { sozId: uuid(i + 1), durum: "aktif", gerceklesen: "0.00", kalan: "9999999999999.99" } })));
    expect(ozet(v).dovizler[0].kalan).toBe("9999999999999990.00");
    expect(sozOzetTutariBicimi(ozet(v).dovizler[0].kalan, "TRY")).toBe("9.999.999.999.999.990,00 TRY");
  });
  it("kaynağı değiştirmez", () => { const v = liste(soz(1)), once = structuredClone(v); expect(ozet(v)).toEqual(ozet(v)); expect(v).toEqual(once); });
  it("başka cari, yinelenen söz ve tutarsız tutarı reddeder", () => {
    expect(() => odemeSozuOzetiniHesapla(liste(soz(1)), uuid(9))).toThrow();
    expect(() => ozet(liste(soz(1), soz(1)))).toThrow();
    const v = liste(soz(1)); v.sozler[0].gerceklesme.kalan = "600.01"; expect(() => ozet(v)).toThrow();
  });
  it.each(["NaN", "-1.00", "01.00", "1.001", "10000000000000000.00"])("geçersiz toplam %s gösterilmez", value => expect(() => sozOzetTutariBicimi(value, "TRY")).toThrow());
});
