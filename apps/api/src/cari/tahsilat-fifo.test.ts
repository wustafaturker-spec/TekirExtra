import { describe, expect, it } from "vitest";
import { tahsilatFifo } from "./cari.raporlar";

const h = (tip: "borc" | "alacak", tutar: number, tarih: string) => ({ tip, tutarTry: tutar, tarih: new Date(`${tarih}T00:00:00Z`) });

describe("tahsilat FIFO (RPR-30)", () => {
  it("alacak en eski borcu kapatır, gün tutarla ağırlıklanır", () => {
    expect(tahsilatFifo([h("borc", 100, "2026-01-01"), h("borc", 100, "2026-01-11"), h("alacak", 150, "2026-01-21")]))
      .toMatchObject({ tahsilEdilen: 150, ortalamaGun: Math.round((100 * 20 + 50 * 10) / 150), acikBakiye: 50 });
  });

  it("avans kaybolmaz: sonraki borcu 0 günle kapatır", () => {
    expect(tahsilatFifo([h("alacak", 80, "2026-01-01"), h("borc", 100, "2026-01-05"), h("alacak", 20, "2026-01-15")]))
      .toMatchObject({ tahsilEdilen: 100, ortalamaGun: 2, acikBakiye: 0 });
  });

  it("aynı gün fatura ve tahsilat sırası sonucu değiştirmez", () => {
    const a = tahsilatFifo([h("borc", 500, "2026-03-01"), h("alacak", 500, "2026-03-01")]);
    const b = tahsilatFifo([h("alacak", 500, "2026-03-01"), h("borc", 500, "2026-03-01")]);
    const ozet = (r: ReturnType<typeof tahsilatFifo>) => ({ tahsilEdilen: r.tahsilEdilen, ortalamaGun: r.ortalamaGun, acikBakiye: r.acikBakiye });
    expect(ozet(a)).toEqual(ozet(b));
    expect(ozet(a)).toEqual({ tahsilEdilen: 500, ortalamaGun: 0, acikBakiye: 0 });
  });

  it("END-19: kapanışlar borç/tahsil tarihiyle, açık borçlar kalanıyla döner", () => {
    const r = tahsilatFifo([h("borc", 100, "2026-01-01"), h("borc", 100, "2026-01-11"), h("alacak", 150, "2026-01-21")]);
    expect(r.kapanislar.map((k) => [k.borcTarih.toISOString().slice(0, 10), k.tahsilTarih.toISOString().slice(0, 10), k.tutar])).toEqual([["2026-01-01", "2026-01-21", 100], ["2026-01-11", "2026-01-21", 50]]);
    expect(r.acikBorclar.map((b) => [b.tarih.toISOString().slice(0, 10), b.kalan])).toEqual([["2026-01-11", 50]]);
  });
});
