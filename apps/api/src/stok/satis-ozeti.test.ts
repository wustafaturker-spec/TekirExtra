import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { fifoDegerleri, satisSatirlari, urunBazinda, type SatisSatiri } from "./satis-ozeti";

const D = (v: number) => new Prisma.Decimal(v);
const h = (id: string, miktar: number, maliyet: number) => ({ id, miktar: D(miktar), maliyet: D(maliyet) });

describe("satış özeti (STK-32)", () => {
  it("FIFO çıkışı en eski girişten tüketir; kuyruk biterse kayıtlı maliyet", () => {
    const d = fifoDegerleri([h("g1", 10, 10), h("g2", 10, 30), h("c1", -15, 20), h("c2", -10, 25)]);
    expect(d.get("c1")!.toNumber()).toBe(10 * 10 + 5 * 30);
    expect(d.get("c2")!.toNumber()).toBe(5 * 30 + 5 * 25);
  });
  it("ürün başına toplar; iade eksi satırı düşer", () => {
    const satir = (miktar: number, ciro: number, maliyet: number, tip: "satis" | "satis_iade"): SatisSatiri => ({ faturaId: "f", faturaNo: "", tarih: new Date(), cariUnvan: "", tip, stokId: "s", kod: "K", ad: "A", mevcutMiktar: D(0), miktar: D(miktar), ciro: D(ciro), maliyet: D(maliyet), hareketPaylari: [] });
    const [u] = urunBazinda([satir(10, 1000, 400, "satis"), satir(-2, -200, -80, "satis_iade")]);
    expect([u.miktar.toNumber(), u.ciro.toNumber(), u.maliyet.toNumber()]).toEqual([8, 800, 320]);
  });
});

describe("çok satırlı satış maliyeti", () => {
  const stok = { kod: "S", ad: "Ürün", tip: "urun", mevcutMiktar: D(0) };
  const satir = (id: string, stokId = "s", varyantId: string | null = null, miktar = 1, birim = "adet") => ({ id, stokId, varyantId, varyant: null, miktar: D(miktar), birim, matrah: D(100), stok });
  const fatura = (id: string, satirlar: ReturnType<typeof satir>[], tip = "satis") => ({ id, no: id, tarih: new Date("2026-10-01"), tip, kur: D(1), cari: null, satirlar });
  it("aynı birimi bekleyen 500 satır ve ikinci fatura yalnız bir katsayı sorgusu paylaşır", async () => {
    const findUnique = vi.fn(async () => { await Promise.resolve(); return { anaBirim: "adet" }; });
    const tx = { fatura: { findMany: async () => [fatura("f", Array.from({ length: 500 }, (_, i) => satir(`${i}`))), fatura("g", [satir("g")])] }, stokKart: { findUnique }, stokHareket: { findMany: async () => [{ id: "h", kaynakRef: "f", stokId: "s", varyantId: null, miktar: D(-500), maliyet: D(10) }] } };
    const rows = await satisSatirlari(tx as never);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(501); expect(rows.slice(0, 500).every((r) => r.maliyet.eq(10))).toBe(true);
    expect(rows[500].maliyet.isZero()).toBe(true);
  });
  it("ürün, varyant, ek birim ve iadenin paylarını ayrı tutar; terslenmiş dilimi netler", async () => {
    const tx = {
      fatura: { findMany: async () => [fatura("f", [satir("a", "s", "v", 1, "paket"), satir("b", "s", "v", 2), satir("c", "s", null), satir("d", "x")]), fatura("i", [satir("i", "s", "v")], "satis_iade")] },
      stokKart: { findUnique: async () => ({ anaBirim: "adet" }) }, stokBirim: { findFirst: async () => ({ katsayi: D(2) }) },
      stokHareket: { findMany: async () => [
        { id: "h1", kaynakRef: "f", stokId: "s", varyantId: "v", miktar: D(-4), maliyet: D(10) },
        { id: "h2", kaynakRef: "f", stokId: "s", varyantId: "v", miktar: D(-1), maliyet: D(5) },
        { id: "h3", kaynakRef: "f", stokId: "s", varyantId: "v", miktar: D(1), maliyet: D(5) },
        { id: "h4", kaynakRef: "f", stokId: "x", varyantId: null, miktar: D(-1), maliyet: D(70) },
        { id: "hi", kaynakRef: "i", stokId: "s", varyantId: "v", miktar: D(1), maliyet: D(10) },
      ] },
    };
    const rows = await satisSatirlari(tx as never);
    expect(rows.map((r) => r.maliyet.toFixed(2))).toEqual(["20.00", "20.00", "0.00", "70.00", "-10.00"]);
    expect(rows.map((r) => r.miktar.toString())).toEqual(["2", "2", "1", "1", "-1"]);
    expect(rows[0].hareketPaylari.map((h) => [h.hareketId, h.oran.toString()])).toEqual([["h1", "0.5"], ["h2", "0.5"], ["h3", "0.5"]]);
  });
  it("tanımsız tarihsel birim katsayısı 1 kalır ve tekrar sorgulanmaz", async () => {
    const findUnique = vi.fn(async () => null);
    const tx = { fatura: { findMany: async () => [fatura("f", [satir("a", "s", null, 1, "eski"), satir("b", "s", null, 2, "eski")])] }, stokKart: { findUnique: async () => ({ anaBirim: "adet" }) }, stokBirim: { findFirst: findUnique }, stokHareket: { findMany: async () => [{ id: "h", kaynakRef: "f", stokId: "s", varyantId: null, miktar: D(-3), maliyet: D(10) }] } };
    expect((await satisSatirlari(tx as never)).map((r) => r.maliyet.toString())).toEqual(["10", "20"]);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});

// Aynı stok kartındaki farklı varyantlar birbirinin maliyetini tamamlayamaz.
describe("satış maliyetinde varyant ayrımı", () => {
  async function kaynak(tip: "satis" | "satis_iade" = "satis") {
    const { satisSatirlari } = await import("./satis-ozeti");
    const stok = { kod: "S", ad: "Ürün", tip: "urun", mevcutMiktar: D(0) };
    const tx = {
      fatura: { findMany: async () => [{ id: "f", no: "F1", tarih: new Date("2026-10-01"), tip, kur: D(1), cari: null,
        satirlar: [
          { id: "a", stokId: "s", varyantId: "va", varyant: { kod: "KIRMIZI", ad: "Kırmızı" }, miktar: D(1), birim: "adet", matrah: D(100), stok },
          { id: "b", stokId: "s", varyantId: "vb", varyant: { kod: "MAVI", ad: "Mavi" }, miktar: D(1), birim: "adet", matrah: D(100), stok },
        ] }] },
      stokKart: { findUnique: async () => ({ anaBirim: "adet" }) },
      stokHareket: { findMany: async () => [{ id: "ha", kaynakRef: "f", stokId: "s", varyantId: "va", miktar: D(tip === "satis" ? -1 : 1), maliyet: D(40) }] },
    };
    return satisSatirlari(tx as never);
  }
  it("tek varyantın hareket maliyeti diğer varyantın eksikliğini gizlemez", async () => {
    const { maliyetBilinmiyor } = await import("./satis-ozeti");
    const rows = await kaynak();
    expect(rows.map((r) => r.maliyet.toString())).toEqual(["40", "0"]);
    expect(rows.map(maliyetBilinmiyor)).toEqual([false, true]);
    expect(rows[1].hareketPaylari).toEqual([]);
  });
  it("satış iadesi yalnız aynı varyantın kayıtlı maliyetini ters çevirir", async () => {
    expect((await kaynak("satis_iade")).map((r) => r.maliyet.toString())).toEqual(["-40", "0"]);
  });
});
