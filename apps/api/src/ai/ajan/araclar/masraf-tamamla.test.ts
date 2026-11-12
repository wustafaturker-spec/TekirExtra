import { describe, expect, it, vi } from "vitest";
import type { AracBaglami } from "./arac";
import { ONAYLI_ARACLAR } from "./onayli";

const arac = ONAYLI_ARACLAR.find((a) => a.ad === "masraf_tamamla")!;
const MASRAF = { id: "m1", saticiUnvan: "Saruhan", toplam: "689.00", stopajTutari: null, odenenTutar: "0", dovizCinsi: "TRY", tarih: new Date("2026-11-11T00:00:00Z"), durum: "taslak" };

function baglam() {
  const cagir = vi.fn(async (uc: { yontem: string }, a: unknown[]) => {
    if (uc.yontem === "getir") return MASRAF;
    if (uc.yontem === "listele") return [{ id: "k1", ad: "KUVEYTTURK 2015", sonDortHane: "2015" }];
    return { ok: true, a };
  });
  return { b: { uc: { cagir }, kaynak: "asistan", arac: "masraf_tamamla" } as unknown as AracBaglami, cagir };
}

describe("masraf_tamamla (CNL-22)", () => {
  it("ödeme fiş tarihinde, kalan tutarla tek çekim; özet okunur tarih verir", async () => {
    const { b, cagir } = baglam();
    const g = { masrafId: "m1", odeme: { tur: "kart" as const, hesapId: "k1" } };
    expect(await arac.ozetle!(b, g)).toBe("Masraf onayı: Saruhan · 689,00 TL · 11.11.2026 · ödeme: kart KUVEYTTURK 2015 (tek çekim)");
    await arac.calistir(b, g);
    const ode = cagir.mock.calls.find(([uc]) => (uc as { yontem: string }).yontem === "ode")!;
    expect(ode[1]).toEqual(["m1", expect.objectContaining({ krediKartiId: "k1", kasaId: null, odemeTarihi: "2026-11-11", ilkTaksitTarihi: "2026-11-11", tutar: "689.00", taksitSayisi: 1 })]);
  });
});
