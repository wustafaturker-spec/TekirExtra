import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { tahsilatCekFiltresi, tahsilatDonemAraligi, tahsilatDonemiTopla, tahsilatHareketFiltresi, tahsilatTopla } from "./tahsilat-ozeti";

describe("Tahsilat dönemi", () => {
  it("Türkiye gece yarısından sonra haftayı pazartesiden başlatır", () => {
    const an = new Date("2026-11-15T21:00:00Z");
    expect(tahsilatDonemAraligi("bu_hafta", an)).toEqual({ baslangic: "2026-11-16", bitis: "2026-11-16" });
    expect(tahsilatDonemAraligi("dun", an)).toEqual({ baslangic: "2026-11-15", bitis: "2026-11-15" });
  });

  it("ayın ilk gününü alır ve gelecek kayıtları döneme katmaz", () => {
    const an = new Date("2026-11-19T09:00:00Z");
    expect(tahsilatDonemAraligi("bu_ay", an)).toEqual({ baslangic: "2026-11-01", bitis: "2026-11-19" });
    expect(tahsilatDonemAraligi("bu_hafta", an)).toEqual({ baslangic: "2026-11-16", bitis: "2026-11-19" });
    const tarih = { gte: new Date("2026-11-01"), lte: new Date("2026-11-19") };
    expect(tahsilatHareketFiltresi("firma", tarih)).toEqual({ tenantId: "firma", tarih, tip: "tahsilat", kaynakTur: { not: "acilis" } });
    expect(tahsilatCekFiltresi("firma", tarih)).toMatchObject({ tenantId: "firma", islemTarihi: tarih, yon: "alinan" });
  });

  it("hareketi bulunan çeki yeniden saymaz ve kuruşları korur", () => {
    const hareketler = [
      { kaynakRef: "cek-1", tutarTry: new Prisma.Decimal("9999999999999.99") },
      { kaynakRef: null, tutarTry: new Prisma.Decimal("0.11") },
    ];
    const cekler = [
      { id: "cek-1", tutarTry: new Prisma.Decimal("9999999999999.99") },
      { id: "cek-2", tutarTry: new Prisma.Decimal("0.22") },
    ];
    expect(tahsilatTopla(hareketler, cekler)).toEqual({ toplam: "10000000000000.32", adet: 3, yeniCekler: [cekler[1]] });
    expect(tahsilatTopla([], [])).toEqual({ toplam: "0.00", adet: 0, yeniCekler: [] });
  });

  it("günlük seriyi sıfır günleriyle doldurur ve dönem toplamını korur", () => {
    const gte = new Date("2026-11-16");
    const lte = new Date("2026-11-19");
    const hareketler = [
      { tarih: new Date("2026-11-18"), kaynakRef: "cek", tutarTry: new Prisma.Decimal("113.45") },
      { tarih: gte, kaynakRef: null, tutarTry: new Prisma.Decimal("10.00") },
    ];
    const cekler = [{ id: "cek", islemTarihi: gte, tutarTry: new Prisma.Decimal("113.45") }];
    expect(tahsilatDonemiTopla(hareketler, cekler, { gte, lte })).toEqual({
      toplam: "123.45",
      adet: 2,
      gunler: [
        { tarih: "2026-11-16", tutar: "10.00" },
        { tarih: "2026-11-17", tutar: "0.00" },
        { tarih: "2026-11-18", tutar: "113.45" },
        { tarih: "2026-11-19", tutar: "0.00" },
      ],
    });
  });
});
