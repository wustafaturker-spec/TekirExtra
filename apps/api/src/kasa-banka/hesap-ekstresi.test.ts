import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { hesapEkstresiHesapla, islemAdi, type EkstreHareketi } from "./hesap-ekstresi";

const D = (v: string | number) => new Prisma.Decimal(v);

let sayac = 0;
function hareket(tip: string, tarih: string, tutar: string, ek: Partial<EkstreHareketi> = {}): EkstreHareketi {
  return {
    id: `h${++sayac}`, tarih: new Date(`${tarih}T00:00:00Z`), tip, tutar: D(tutar), kur: D(1), tutarTry: D(tutar),
    kaynakTur: "manuel", makbuzNo: null, aciklama: null, cari: null, belge: null, karsiHesap: null, ...ek,
  };
}

describe("hesapEkstresiHesapla", () => {
  it("devirden başlayıp yürüyen bakiyeyi ve dönem toplamlarını hesaplar", () => {
    const sonuc = hesapEkstresiHesapla(
      [{ tip: "tahsilat", tutar: D(1000), tutarTry: D(1000) }, { tip: "virman_gidis", tutar: D(250), tutarTry: D(250) }],
      [hareket("tahsilat", "2026-10-01", "500"), hareket("tediye", "2026-10-02", "1500"), hareket("virman_gelis", "2026-10-03", "100")],
    );
    expect(sonuc.devir).toBe("750.00");
    expect(sonuc.satirlar.map((s) => s.bakiye)).toEqual(["1250.00", "-250.00", "-150.00"]);
    expect(sonuc.giris).toBe("600.00");
    expect(sonuc.cikis).toBe("1500.00");
    expect(sonuc.donemSonu).toBe("-150.00");
    expect(sonuc.satirlar[1]).toMatchObject({ giris: null, cikis: "1500.00", tutarTry: "-1500.00" });
  });

  it("dövizli hesapta TL karşılığını her hareketin kendi kuruyla toplar", () => {
    const sonuc = hesapEkstresiHesapla(
      [{ tip: "tahsilat", tutar: D(100), tutarTry: D(3000) }],
      [hareket("tahsilat", "2026-10-01", "50", { kur: D(40), tutarTry: D(2000) }), hareket("tediye", "2026-10-02", "30", { kur: D(41), tutarTry: D(1230) })],
    );
    expect(sonuc.donemSonu).toBe("120.00");
    expect(sonuc.devirTry).toBe("3000.00");
    expect(sonuc.girisTry).toBe("2000.00");
    expect(sonuc.cikisTry).toBe("1230.00");
    expect(sonuc.donemSonuTry).toBe("3770.00");
  });

  it("hareket yoksa dönem sonu devire eşittir", () => {
    const sonuc = hesapEkstresiHesapla([{ tip: "tediye", tutar: D(80), tutarTry: D(80) }], []);
    expect(sonuc.devir).toBe("-80.00");
    expect(sonuc.donemSonu).toBe("-80.00");
    expect(sonuc.satirlar).toEqual([]);
  });
});

describe("islemAdi", () => {
  it("açılış ve ters kaydı tipten önce adlandırır", () => {
    expect(islemAdi({ tip: "tahsilat", kaynakTur: "acilis" })).toBe("Açılış");
    expect(islemAdi({ tip: "tediye", kaynakTur: "acilis" })).toBe("Açılış");
    expect(islemAdi({ tip: "tahsilat", kaynakTur: "ters_kayit" })).toBe("Ters kayıt");
    expect(islemAdi({ tip: "tediye", kaynakTur: "masraf" })).toBe("Ödeme");
    expect(islemAdi({ tip: "virman_gelis", kaynakTur: "manuel" })).toBe("Virman girişi");
  });
});
