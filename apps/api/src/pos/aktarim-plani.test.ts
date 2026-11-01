import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { aktarimPlani, valorTarihi } from "./aktarim-plani";

const D = (v: string | number) => new Prisma.Decimal(v);
// İstanbul saatiyle verilen anı UTC Date'e çevirir.
const an = (istanbul: string) => new Date(new Date(`${istanbul}Z`).getTime() - 3 * 60 * 60 * 1000);

describe("valorTarihi", () => {
  it("ödeme gününü İstanbul saatine göre alıp valör günü ekler", () => {
    expect(valorTarihi(an("2026-10-02T23:30:00"), 1)).toBe("2026-10-03");
    expect(valorTarihi(an("2026-10-03T00:30:00"), 1)).toBe("2026-10-04");
    expect(valorTarihi(an("2026-01-31T10:00:00"), 30)).toBe("2026-03-02");
    expect(valorTarihi(an("2026-10-02T10:00:00"), 0)).toBe("2026-10-02");
  });
});

describe("aktarimPlani", () => {
  const hesap = { valorGun: 1, komisyonOrani: "2.5" };
  const tahsilatlar = [
    { id: "a", odemeTarihi: an("2026-09-28T10:00:00"), net: D(1000) },
    { id: "b", odemeTarihi: an("2026-10-01T10:00:00"), net: D(400) },
    { id: "c", odemeTarihi: an("2026-10-01T15:00:00"), net: D(600) },
    { id: "d", odemeTarihi: an("2026-10-02T09:00:00"), net: D(300) },
  ];

  it("bakiyeyi en yeni ödemeden geriye dağıtır, valöre göre gruplar ve komisyon önerir", () => {
    const plan = aktarimPlani(D(1200), tahsilatlar, hesap, "2026-10-02");
    expect(plan.gruplar).toEqual([
      { valorTarihi: "2026-10-02", vadesiGeldi: true, adet: 2, brut: "900.00", onerilenKomisyon: "22.50", net: "877.50", tahsilatIdleri: ["c", "b"] },
      { valorTarihi: "2026-10-03", vadesiGeldi: false, adet: 1, brut: "300.00", onerilenKomisyon: "7.50", net: "292.50", tahsilatIdleri: ["d"] },
    ]);
    expect(plan.dagitilamayan).toBe("0.00");
  });

  it("KSB-35: işlem başı ücreti tahsilat başına komisyona ekler", () => {
    const plan = aktarimPlani(D(1200), tahsilatlar, { ...hesap, islemUcreti: "0.25" }, "2026-10-02");
    expect(plan.gruplar.map((g) => g.onerilenKomisyon)).toEqual(["23.00", "7.75"]);
    expect(plan.gruplar[0].net).toBe("877.00");
  });

  it("KSB-36: tahsilatın kendi komisyonunu kullanır, kısmi payda oranlar; komisyonsuz eski kayıtta hesabın oranına düşer", () => {
    const t = [
      { id: "x", odemeTarihi: an("2026-10-01T10:00:00"), net: D(1000), komisyon: D("35.15") },
      { id: "y", odemeTarihi: an("2026-10-01T11:00:00"), net: D(400), komisyon: null },
    ];
    // y'nin tamamı (400, %2,5 = 10) + x'in yarısı (500, 35,15/2 = 17,58)
    const plan = aktarimPlani(D(900), t, hesap, "2026-10-02");
    expect(plan.gruplar[0]).toMatchObject({ brut: "900.00", onerilenKomisyon: "27.58", net: "872.42" });
  });

  it("tahsilatlardan büyük bakiyenin artanını dağıtılamayan olarak verir; sıfır ve eksi bakiyede plan boştur", () => {
    expect(aktarimPlani(D(2500), tahsilatlar, hesap, "2026-10-02").dagitilamayan).toBe("200.00");
    expect(aktarimPlani(D(0), tahsilatlar, hesap, "2026-10-02").gruplar).toEqual([]);
    expect(aktarimPlani(D(-50), tahsilatlar, hesap, "2026-10-02").gruplar).toEqual([]);
  });

  it("tamamı iade edilmiş tahsilatı atlar", () => {
    const plan = aktarimPlani(D(300), [...tahsilatlar.slice(0, 3), { ...tahsilatlar[3], net: D(0) }], hesap, "2026-10-02");
    expect(plan.gruplar[0].tahsilatIdleri).toEqual(["c"]);
    expect(plan.gruplar[0].brut).toBe("300.00");
  });
});
