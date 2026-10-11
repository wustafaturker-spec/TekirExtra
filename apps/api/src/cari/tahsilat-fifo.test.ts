import { describe, expect, it } from "vitest";
import { tahsilatFifo } from "./cari.raporlar";

const h = (tip: "borc" | "alacak", tutar: number, tarih: string) => ({ tip, tutarTry: tutar, tarih: new Date(`${tarih}T00:00:00Z`) });

describe("tahsilat FIFO (RPR-30)", () => {
  it("alacak en eski borcu kapatır, gün tutarla ağırlıklanır", () => {
    expect(tahsilatFifo([h("borc", 100, "2026-01-01"), h("borc", 100, "2026-01-11"), h("alacak", 150, "2026-01-21")]))
      .toEqual({ tahsilEdilen: 150, ortalamaGun: Math.round((100 * 20 + 50 * 10) / 150), acikBakiye: 50 });
  });

  it("avans kaybolmaz: sonraki borcu 0 günle kapatır", () => {
    expect(tahsilatFifo([h("alacak", 80, "2026-01-01"), h("borc", 100, "2026-01-05"), h("alacak", 20, "2026-01-15")]))
      .toEqual({ tahsilEdilen: 100, ortalamaGun: 2, acikBakiye: 0 });
  });

  it("aynı gün fatura ve tahsilat sırası sonucu değiştirmez", () => {
    const a = tahsilatFifo([h("borc", 500, "2026-03-01"), h("alacak", 500, "2026-03-01")]);
    const b = tahsilatFifo([h("alacak", 500, "2026-03-01"), h("borc", 500, "2026-03-01")]);
    expect(a).toEqual(b);
    expect(a).toEqual({ tahsilEdilen: 500, ortalamaGun: 0, acikBakiye: 0 });
  });
});
