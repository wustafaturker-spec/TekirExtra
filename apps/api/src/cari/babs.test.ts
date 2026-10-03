import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { babsKalemleri, babsOzeti, donemAraligi, kisiAnahtari, type BabsKalemi } from "./babs";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const cari = (id: string, vknTckn: string | null, ulke = "TR") => ({ id, kod: id.toUpperCase(), unvan: `Cari ${id}`, vknTckn, adresler: [{ tip: "fatura", ulke }] });

describe("Form BA/BS kalemleri (CARI-37)", () => {
  it("iadeler düzenleyene göre ayrılır; faturalı masraf ve SMM BA'ya girer; dövizli belge kendi kuruyla TL", async () => {
    let faturaSorgusu: unknown;
    let masrafSorgusu: unknown;
    const tx = {
      fatura: {
        findMany: async (q: unknown) => {
          faturaSorgusu = q;
          return [
            { tip: "alis", no: "A1", tarih: new Date("2026-09-03"), toplamMatrah: D(4000), kur: D(1), cari: cari("t", "1111111111") },
            { tip: "satis_iade", no: "SI1", tarih: new Date("2026-09-05"), toplamMatrah: D(500), kur: D(1), cari: cari("m", "2222222221") },
            { tip: "satis", no: "S1", tarih: new Date("2026-09-10"), toplamMatrah: D(100), kur: D(40), cari: cari("x", "2222222222", "DE") },
            { tip: "alis_iade", no: "AI1", tarih: new Date("2026-09-12"), toplamMatrah: D(300), kur: D(1), cari: cari("t", "1111111111") },
          ];
        },
      },
      masraf: {
        findMany: async (q: unknown) => {
          masrafSorgusu = q;
          return [
            { belgeTuru: "fatura", belgeNo: "M1", tarih: new Date("2026-09-15"), matrah: D(1500), kur: D(1), saticiUnvan: "Kiracı Ltd", vknTckn: "9999999999", cari: null },
            { belgeTuru: "serbest_meslek_makbuzu", belgeNo: "SMM1", tarih: new Date("2026-09-20"), matrah: D(800), kur: D(1), saticiUnvan: null, vknTckn: "5555555555", cari: cari("t", "1111111111") },
          ];
        },
      },
    } as unknown as Prisma.TransactionClient;

    const kalemler = await babsKalemleri(tx, 2026, 9);
    expect(faturaSorgusu).toMatchObject({ where: { durum: "kesin", tarih: donemAraligi(2026, 9) } });
    expect(masrafSorgusu).toMatchObject({ where: { durum: "onaylandi", belgeTuru: { in: ["fatura", "serbest_meslek_makbuzu"] } } });
    expect(kalemler.map((k) => [k.belge, k.form, k.tutarTry])).toEqual([
      ["alis", "ba", 4000], ["satis_iade", "ba", 500], ["satis", "bs", 4000], ["alis_iade", "bs", 300], ["masraf", "ba", 1500], ["smm", "ba", 800],
    ]);
    // Cari bağlı masrafta kartın VKN'si esastır.
    expect(kalemler[5]).toMatchObject({ vknTckn: "1111111111", unvan: "Cari t" });
    expect(kalemler[2].ulke).toBe("DE");
  });

  it("dönem ayın ilk gününden sonraki ayın ilk gününe kadardır", () => {
    expect(donemAraligi(2026, 12)).toEqual({ gte: new Date("2026-12-01T00:00:00Z"), lt: new Date("2027-01-01T00:00:00Z") });
  });
});

describe("Form BA/BS özeti (CARI-37)", () => {
  const k = (form: "ba" | "bs", tutarTry: number, cariId: string | null, vknTckn: string | null, unvan = "X"): BabsKalemi =>
    ({ form, belge: form === "ba" ? "alis" : "satis", belgeNo: null, tarih: new Date("2026-09-01"), tutarTry, cariId, cariKod: cariId?.toUpperCase() ?? null, unvan, vknTckn, ulke: "TR" });

  it("aynı VKN'li iki cari tek kişidir; eşik toplamla aşılır, belge sayısı birlikte sayılır", () => {
    const ozet = babsOzeti([k("ba", 3000, "c1", "1234567890"), k("ba", 2500, "c2", "1234567890"), k("ba", 4500, "c3", "5555555555"), k("ba", 1000, "c4", "6666666666")], 5000);
    expect(ozet.map((s) => [s.anahtar, s.belgeSayisi, s.tutar, s.durum, s.cariKodlari.join(",")])).toEqual([
      ["vkn:1234567890", 2, 5500, "bildirilir", "C1,C2"],
      ["vkn:5555555555", 1, 4500, "esige_yakin", "C3"],
      ["vkn:6666666666", 1, 1000, "esik_alti", "C4"],
    ]);
  });

  it("BA ve BS ayrı toplanır; eşik tam tutarda bildirilir", () => {
    const ozet = babsOzeti([k("ba", 5000, "c1", "1234567890"), k("bs", 4999.99, "c1", "1234567890")], 5000);
    expect(ozet.find((s) => s.form === "ba")!.durum).toBe("bildirilir");
    expect(ozet.find((s) => s.form === "bs")!.durum).toBe("esige_yakin");
  });

  it("yurt dışı alıcı ve nihai tüketici kimliği cari başına ayrılır; kimliksiz satıcı unvanla", () => {
    expect(kisiAnahtari({ vknTckn: "2222222222", cariId: "a", unvan: "A" })).toBe("cari:a");
    expect(kisiAnahtari({ vknTckn: "11111111111", cariId: "b", unvan: "B" })).toBe("cari:b");
    expect(kisiAnahtari({ vknTckn: null, cariId: null, unvan: "Şişli Ltd" })).toBe(kisiAnahtari({ vknTckn: "", cariId: null, unvan: "sisli ltd" }));
  });
});
