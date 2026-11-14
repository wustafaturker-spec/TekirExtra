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
    expect(await gonderenCariSec(tx([]), "t", "1", "tedarikci")).toEqual({ cari: null, uyari: null, cokluUyari: null });
  });
  it("uygun tipte tek kart varsa (öteki müşteri) uyarı yok; birleştirilmiş kartlar aday değil", async () => {
    const t = tx([{ id: "h", kod: "TED-001", tip: "her_ikisi" }, { id: "m", kod: "CARI-005", tip: "musteri" }]);
    const r = await gonderenCariSec(t, "t", "1234567802", "tedarikci");
    expect(r).toMatchObject({ cari: { id: "h" }, uyari: null, cokluUyari: null });
    expect((t as unknown as { cariHesap: { findMany: ReturnType<typeof vi.fn> } }).cariHesap.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t", vknTckn: "1234567802", birlestigiCariId: null });
  });
  it("uygun tipte birden çok kart: en eski seçilir ve aynı VKN uyarısı verilir", async () => {
    const r = await gonderenCariSec(tx([{ id: "a", kod: "TED-001", tip: "tedarikci" }, { id: "b", kod: "TED-009", tip: "her_ikisi" }]), "t", "1234567802", "tedarikci");
    expect(r.cari?.id).toBe("a");
    expect(r.uyari).toBeNull();
    expect(r.cokluUyari).toMatch(/^VKN 1234567802 birden çok caride kayıtlı: TED-001 \(X\), TED-009 \(X\)\. Belge en eski kart TED-001 carisine işlenir/);
  });
});
