import { describe, expect, it, vi } from "vitest";
import { kanuniDegerOku } from "./kanuni-deger";
import { babsEsigi } from "../cari/babs";

describe("kanuni değer okuma (MVZ-13)", () => {
  it("belge tarihinde yürürlükteki merkezi değeri okur", async () => {
    const db = { mevzuatKayit: { findFirst: vi.fn().mockResolvedValue({ deger: { deger: 7 } }) } };
    expect(await kanuniDegerOku(db as never, "irsaliye_fatura_gun", "2026-10-09", 99)).toBe(7);
    expect(db.mevzuatKayit.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tur: "kanuni_deger", anahtar: "irsaliye_fatura_gun", yururlukBaslangic: { lte: new Date("2026-10-09T00:00:00Z") }, OR: [{ yururlukBitis: null }, { yururlukBitis: { gte: new Date("2026-10-09T00:00:00Z") } }] },
      orderBy: { yururlukBaslangic: "desc" },
    }));
  });

  it("kayıt yoksa ya da değer bozuksa varsayılanı verir", async () => {
    expect(await kanuniDegerOku({ mevzuatKayit: { findFirst: vi.fn().mockResolvedValue(null) } } as never, "babs_esigi", "2026-10-09", 5000)).toBe(5000);
    expect(await kanuniDegerOku({ mevzuatKayit: { findFirst: vi.fn().mockResolvedValue({ deger: { deger: "x" } }) } } as never, "babs_esigi", "2026-10-09", 5000)).toBe(5000);
  });

  it("BA/BS eşiği dönemin ilk günündeki merkezi değerdir", async () => {
    const tx = { mevzuatKayit: { findFirst: vi.fn().mockResolvedValue({ deger: { deger: 8000 } }) } };
    expect(await babsEsigi(tx as never, 2026, 3)).toBe(8000);
    expect(tx.mevzuatKayit.findFirst.mock.calls[0][0].where.yururlukBaslangic).toEqual({ lte: new Date("2026-03-01T00:00:00Z") });
  });
});
