import { describe, expect, it, vi } from "vitest";
import { gonderenCariSec } from "./tedarikci-cari";

const tx = (adaylar: { id: string; kod: string; tip: string }[]) => ({ cariHesap: { findMany: vi.fn().mockResolvedValue(adaylar.map((a) => ({ unvan: "X", karaListe: false, ...a }))) } }) as never;

describe("gönderen cari seçimi", () => {
  it("aynı VKN'li carilerden belgenin yönüne uygun olanı seçer", async () => {
    const adaylar = [{ id: "m", kod: "CARI-005", tip: "musteri" }, { id: "h", kod: "TED-001", tip: "her_ikisi" }];
    expect((await gonderenCariSec(tx(adaylar), "t", "1234567802", "tedarikci")).cari?.id).toBe("h");
    expect((await gonderenCariSec(tx(adaylar), "t", "1234567802", "musteri")).cari?.id).toBe("m");
  });
  it("uygun cari yoksa ilkini döner ve nedenini söyler", async () => {
    const r = await gonderenCariSec(tx([{ id: "m", kod: "CARI-005", tip: "musteri" }]), "t", "1234567802", "tedarikci");
    expect(r.cari?.id).toBe("m");
    expect(r.uyari).toMatch(/CARI-005 müşteri tipinde; alış faturası için tedarikçi ya da her ikisi/);
  });
  it("kayıt yoksa cari de uyarı da yok", async () => {
    expect(await gonderenCariSec(tx([]), "t", "1", "tedarikci")).toEqual({ cari: null, uyari: null });
  });
});
