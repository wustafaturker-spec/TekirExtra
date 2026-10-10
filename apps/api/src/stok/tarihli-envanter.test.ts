import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { tarihliBakiyeler, type EnvanterHareketi } from "./tarihli-envanter";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
let sira = 0;
const h = (miktar: number, maliyet: number, ek: Partial<EnvanterHareketi> = {}): EnvanterHareketi => ({
  id: `h${++sira}`, stokId: "s1", depoId: "d1", miktar: D(miktar), maliyet: D(maliyet), kaynakTur: "manuel", kaynakRef: null, ...ek,
});

describe("tarihliBakiyeler (STK-37)", () => {
  it("girişlerden ağırlıklı ortalama, çıkışlar ortalamayı değiştirmez", () => {
    const b = tarihliBakiyeler([h(10, 100), h(10, 200), h(-5, 150)], new Set()).get("s1")!;
    expect(b.miktar.toNumber()).toBe(15);
    expect(b.ortalama.toNumber()).toBe(150);
  });

  it("alış iadesi alış maliyetiyle ortalamadan düşer", () => {
    const b = tarihliBakiyeler([h(10, 100), h(10, 200), h(-10, 200, { kaynakTur: "fatura", kaynakRef: "f-iade" })], new Set(["f-iade"])).get("s1")!;
    expect(b.ortalama.toNumber()).toBe(100);
  });

  it("fatura iptal tersi girdiği maliyetle çıkar", () => {
    const b = tarihliBakiyeler([h(10, 100), h(10, 200, { kaynakTur: "fatura", kaynakRef: "f1" }), h(-10, 200, { kaynakTur: "fatura_iptal", kaynakRef: "f1" })], new Set()).get("s1")!;
    expect(b.miktar.toNumber()).toBe(10);
    expect(b.ortalama.toNumber()).toBe(100);
  });

  it("depo miktarları ayrı tutulur, ortalama firma geneli", () => {
    const b = tarihliBakiyeler([h(10, 100), h(-4, 100, { depoId: "d1" }), h(4, 100, { depoId: "d2" })], new Set()).get("s1")!;
    expect(b.depoMiktarlari.get("d1")!.toNumber()).toBe(6);
    expect(b.depoMiktarlari.get("d2")!.toNumber()).toBe(4);
    expect(b.ortalama.toNumber()).toBe(100);
  });
});
