import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { cekVadeAnalizi, type VadeEvraki } from "./cek-vade-analizi";
const evrak = (tarih: string, ek: Partial<VadeEvraki> = {}): VadeEvraki => ({ yon: "alinan", durum: "portfoyde", vadeTarihi: new Date(tarih), tutar: new Prisma.Decimal("100.01"), dovizCinsi: "TRY", ...ek });
describe("çek vade analizi", () => {
  it("aralık sınırlarında her evrakı yalnız bir gruba alır", () => {
    const s = cekVadeAnalizi(["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-21", "2026-10-22", "2026-11-13", "2026-11-14", "2027-01-12", "2027-01-13"].map((t) => evrak(t)), "2026-10-14");
    expect(s.gruplar.map((g) => g.alinan.adet)).toEqual([1, 1, 2, 2, 2, 1]);
    expect(s.toplam.alinan.adet).toBe(9);
  });
  it("dövizleri ve alınan/verilen tutarlarını karıştırmaz; Decimal kullanır", () => {
    const s = cekVadeAnalizi([evrak("2026-10-14"), evrak("2026-10-14"), evrak("2026-10-14", { dovizCinsi: "USD" }),
      evrak("2026-10-14", { yon: "verilen", durum: "verildi", tutar: new Prisma.Decimal("9999999999999.99") })], "2026-10-14");
    expect(s.gruplar[1].alinan.dovizler).toEqual([{ doviz: "TRY", tutar: "200.02", adet: 2 }, { doviz: "USD", tutar: "100.01", adet: 1 }]);
    expect(s.gruplar[1].verilen.dovizler[0].tutar).toBe("9999999999999.99");
  });
  it("tahsil/ödeme/ciro/iade/karşılıksız evrakları açık vade hesabına katmaz", () => {
    const s = cekVadeAnalizi(["tahsil_edildi", "odendi", "ciro_edildi", "iade_edildi", "karsiliksiz"].map((durum) => evrak("2026-10-14", { durum })), "2026-10-14");
    expect(s.toplam.alinan.adet).toBe(0);
  });
  it("bankada ve teminattaki evrakları kapsar, boş portföyü sıfır gösterir", () => {
    expect(cekVadeAnalizi([evrak("2026-10-14", { durum: "tahsile_verildi" }), evrak("2026-10-14", { durum: "teminata_verildi" })], "2026-10-14").toplam.alinan.adet).toBe(2);
    expect(cekVadeAnalizi([], "2026-10-14").toplam.verilen).toEqual({ adet: 0, dovizler: [] });
  });
});
