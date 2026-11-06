import { describe, expect, it } from "vitest";
import { firmaDilimi, taranacakFirmalar } from "./bildirim-zamanlayici.service";

const BES_DK = 5 * 60 * 1000;
const idler = Array.from({ length: 1200 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

describe("BLD-11 pasif firma dilimi", () => {
  it("dilim kararlıdır ve aralıkta kalır", () => {
    expect(firmaDilimi(idler[5]!, 12)).toBe(firmaDilimi(idler[5]!, 12));
    for (const id of idler) expect(firmaDilimi(id, 12)).toBeGreaterThanOrEqual(0), expect(firmaDilimi(id, 12)).toBeLessThan(12);
  });

  it("aktifler her çalışmada, pasifler saatte tam bir kez taranır", () => {
    const aktifler = new Set(idler.slice(0, 50));
    const sayac = new Map<string, number>();
    const t0 = Date.UTC(2026, 10, 6, 10, 0);
    for (let i = 0; i < 12; i++) {
      const s = taranacakFirmalar(idler, aktifler, BES_DK, t0 + i * BES_DK);
      expect(s.aktif).toBe(50);
      expect(s.aktif + s.pasifTaranan + s.atlanan).toBe(idler.length);
      for (const id of s.taranacak) sayac.set(id, (sayac.get(id) ?? 0) + 1);
    }
    for (const id of idler.slice(0, 50)) expect(sayac.get(id)).toBe(12);
    for (const id of idler.slice(50)) expect(sayac.get(id)).toBe(1);
  });

  it("pasifler dilimlere kabaca eşit dağılır", () => {
    const t0 = Date.UTC(2026, 10, 6, 10, 0);
    const adetler = Array.from({ length: 12 }, (_, i) => taranacakFirmalar(idler, new Set(), BES_DK, t0 + i * BES_DK).pasifTaranan);
    for (const n of adetler) expect(n).toBeGreaterThan(60), expect(n).toBeLessThan(140);
  });

  it("aralık 1 saatten uzunsa her çalışmada herkes taranır", () => {
    expect(taranacakFirmalar(idler.slice(0, 10), new Set(), 2 * 60 * 60 * 1000).taranacak).toHaveLength(10);
  });
});
