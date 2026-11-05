import { describe, expect, it } from "vitest";
import { paketKapsamSemasi } from "./paket-kapsami";
const temel = { semaSurumu: 1, moduller: ["cari"], kotalar: { kullanici: { sinir: 3, uyariYuzdesi: 80 }, cari: { sinir: 5, uyariYuzdesi: 80 }, stok: { sinir: 0, uyariYuzdesi: 80 }, aylikFatura: { sinir: 10, uyariYuzdesi: 80 } } };
describe("depolama sözleşmesi", () => {
  it("eski sözleşmeye depolama eklemez; sıfır, sınırsız ve bigint sınırını hassasiyet kaybetmeden korur", () => {
    expect(paketKapsamSemasi.parse(temel)).not.toHaveProperty("depolama");
    for (const sinirBayt of [null, "0", "9223372036854775807"]) expect(paketKapsamSemasi.parse({ ...temel, depolama: { sinirBayt, uyariYuzdesi: 80 } }).depolama?.sinirBayt).toBe(sinirBayt);
  });
  it.each(["", "-1", "01", "1.5", "9223372036854775808", 100])("geçersiz bayt sınırını reddeder: %j", (sinirBayt) => {
    expect(paketKapsamSemasi.safeParse({ ...temel, depolama: { sinirBayt, uyariYuzdesi: 80 } }).success).toBe(false);
  });
});
