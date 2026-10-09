import { describe, expect, it, vi } from "vitest";
import { donemBordroMevzuati } from "./bordro-mevzuati";

describe("dönemin bordro mevzuatı (MVZ-14)", () => {
  it("dönem başında yürürlükteki kayıt, yalnız aynı takvim yılında başlamışsa", async () => {
    const findFirst = vi.fn(async () => null);
    expect(await donemBordroMevzuati({ mevzuatKayit: { findFirst } } as never, 2027, 1)).toBeNull();
    const where = (findFirst.mock.calls[0] as unknown as [{ where: { yururlukBaslangic: { lte: Date; gte: Date } } }])[0].where;
    expect(where.yururlukBaslangic.lte.toISOString().slice(0, 10)).toBe("2027-01-01");
    // 2026'da başlayan açık kayıt 2027 Ocak'a uygulanmaz.
    expect(where.yururlukBaslangic.gte.toISOString().slice(0, 10)).toBe("2027-01-01");
  });
});
