import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { paylariHesapla } from "./maliyet-dagitimi";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const satir = (id: string, matrah: number, miktar: number) => ({ faturaSatirId: id, matrahTl: D(matrah), anaMiktar: D(miktar) });

describe("paylariHesapla (STK-40)", () => {
  it("tutara göre matrah oranında dağıtır", () => {
    const p = paylariHesapla("100", "tutar", [satir("a", 300, 1), satir("b", 100, 9)]);
    expect(p.map((s) => s.pay.toString())).toEqual(["75", "25"]);
  });

  it("miktara göre ana birim miktarı oranında dağıtır", () => {
    const p = paylariHesapla("100", "miktar", [satir("a", 300, 1), satir("b", 100, 9)]);
    expect(p.map((s) => s.pay.toString())).toEqual(["10", "90"]);
  });

  it("yuvarlama farkını en büyük paya ekler, toplam tam tutar", () => {
    const p = paylariHesapla("100", "miktar", [satir("a", 1, 1), satir("b", 1, 1), satir("c", 1, 1)]);
    expect(p.reduce((t, s) => t.add(s.pay), D(0)).toString()).toBe("100");
    expect(p.map((s) => s.pay.toString()).sort()).toEqual(["33.33", "33.33", "33.34"]);
  });

  it("ağırlık sıfırsa reddeder", () => {
    expect(() => paylariHesapla("10", "tutar", [satir("a", 0, 5)])).toThrow("miktara göre");
  });
});
