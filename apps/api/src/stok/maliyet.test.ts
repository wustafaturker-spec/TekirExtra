import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { agirlikliMaliyet, alisBirimMaliyeti, girisOrtalamasi, maliyetleriYenidenHesapla, maliyetliCikisOrtalamasi, type YenidenHareket } from "./maliyet";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const h = (id: string, miktar: number, ek: Partial<YenidenHareket> = {}): YenidenHareket => ({ id, miktar: D(miktar), maliyet: D(0), giris: miktar > 0, maliyetliCikis: false, sabit: false, kural: miktar > 0 ? { tur: "kayitli" } : { tur: "ortalama" }, ...ek });

describe("maliyet çekirdeği (STK-25…28)", () => {
  it("alış maliyeti: net matrah × kur ÷ ana birim miktarı", () => {
    expect(alisBirimMaliyeti(800, 1, 10).toNumber()).toBe(80); // %20 iskontolu 10 × 100
    expect(alisBirimMaliyeti(100, 40, 10).toNumber()).toBe(400); // 10 × 10 USD, kur 40
    expect(alisBirimMaliyeti(300, 1, 20).toNumber()).toBe(15); // 2 koli × 150, koli = 10 adet
    expect(alisBirimMaliyeti(100, 1, 0).toNumber()).toBe(0);
  });
  it("giriş ortalaması: eski stok eksi/sıfırsa giren maliyet, yeni ≤ 0 ise korunur", () => {
    expect(girisOrtalamasi(10, 80, 10, 400).toNumber()).toBe(240);
    expect(girisOrtalamasi(-5, 80, 10, 50).toNumber()).toBe(50);
    expect(girisOrtalamasi(-5, 80, 3, 50).toNumber()).toBe(80);
  });
  it("alış maliyetiyle çıkış ortalamadan düşer; kalan ≤ 0 ya da eksi sonuçta korunur", () => {
    expect(maliyetliCikisOrtalamasi(20, 20, 10, 30).toNumber()).toBe(10);
    expect(maliyetliCikisOrtalamasi(10, 20, 10, 30).toNumber()).toBe(20);
    expect(maliyetliCikisOrtalamasi(10, 5, 5, 30).toNumber()).toBe(5);
  });
  it("ağırlıklı maliyet işaretten bağımsız", () => {
    expect(agirlikliMaliyet([{ miktar: -2, maliyet: 10 }, { miktar: -6, maliyet: 20 }])?.toNumber()).toBe(17.5);
    expect(agirlikliMaliyet([])).toBeNull();
  });
});

describe("maliyeti yeniden hesaplama (STK-28)", () => {
  it("alış faturadan, satış çıkışı o anki ortalama, satış iadesi kaynak çıkışın maliyetiyle", () => {
    const { maliyetler, ortalama } = maliyetleriYenidenHesapla([
      h("a1", 10, { maliyet: D(100), kural: { tur: "sabit", maliyet: D(80) } }),
      h("a2", 10, { maliyet: D(10), kural: { tur: "sabit", maliyet: D(400) } }),
      h("s1", -5, { maliyet: D(55) }),
      h("i1", 5, { maliyet: D(1000), kural: { tur: "kaynak", hareketIdleri: ["s1"] } }),
    ]);
    expect(maliyetler.get("s1")!.toNumber()).toBe(240);
    expect(maliyetler.get("i1")!.toNumber()).toBe(240);
    expect(ortalama.toNumber()).toBe(240);
  });
  it("alış iptali tersi girişin yeni maliyetiyle çıkıp ortalamayı geri alır", () => {
    const { maliyetler, ortalama } = maliyetleriYenidenHesapla([
      h("g", 10, { maliyet: D(10) }),
      h("a", 10, { kural: { tur: "sabit", maliyet: D(30) } }),
      h("t", -10, { maliyetliCikis: true, kural: { tur: "kaynak", hareketIdleri: ["a"] } }),
    ]);
    expect(maliyetler.get("t")!.toNumber()).toBe(30);
    expect(ortalama.toNumber()).toBe(10);
  });
  it("kapalı dönem hareketi kayıtlı maliyetiyle kalır ve ortalamaya öyle girer", () => {
    const { maliyetler, ortalama } = maliyetleriYenidenHesapla([
      h("k", 10, { maliyet: D(100), sabit: true, kural: { tur: "sabit", maliyet: D(80) } }),
      h("s", -5, { maliyet: D(1), sabit: true }),
      h("a", 5, { kural: { tur: "sabit", maliyet: D(40) } }),
      h("s2", -1),
    ]);
    expect(maliyetler.get("k")!.toNumber()).toBe(100);
    expect(maliyetler.get("s")!.toNumber()).toBe(1);
    expect(ortalama.toNumber()).toBe(70);
    expect(maliyetler.get("s2")!.toNumber()).toBe(70);
  });
  it("kaynağı olmayan iade o anki ortalamayla girer", () => {
    const { maliyetler } = maliyetleriYenidenHesapla([h("g", 10, { maliyet: D(70) }), h("i", 5, { kural: { tur: "kaynak", hareketIdleri: [] } })]);
    expect(maliyetler.get("i")!.toNumber()).toBe(70);
  });

  it("sayım düzeltmesi stok pozitifse ortalamayla, değilse kayıtlı maliyetle", () => {
    const { maliyetler, ortalama } = maliyetleriYenidenHesapla([
      h("s0", 500, { maliyet: D(42), kural: { tur: "sayim" } }),
      h("a", 500, { kural: { tur: "sabit", maliyet: D(62) } }),
      h("s1", 100, { maliyet: D(1), kural: { tur: "sayim" } }),
    ]);
    expect(maliyetler.get("s0")!.toNumber()).toBe(42);
    expect(maliyetler.get("s1")!.toNumber()).toBe(52);
    expect(ortalama.toNumber()).toBe(52);
  });
});
