import { afterEach, describe, expect, it } from "vitest";
import {
  _tumRaporlariTemizle,
  girdiDogrula,
  raporTanimiAl,
  raporTanimlari,
  registerRapor,
  siralamaUygula,
  type RaporTanimi,
} from "./rapor-kayit";

const ornekTanim = (): RaporTanimi => ({
  kod: "test.ornek",
  modul: "cari",
  ad: "Örnek Rapor",
  filtreler: [
    { alan: "baslangic", ad: "Başlangıç", tip: "tarih" },
    { alan: "cari", ad: "Cari", tip: "cari", zorunlu: true },
    { alan: "adet", ad: "Adet", tip: "sayi" },
    {
      alan: "yon",
      ad: "Yön",
      tip: "secim",
      secenekler: [{ deger: "cok", ad: "Çok" }],
    },
  ],
  gruplamalar: [{ deger: "ay", ad: "Ay" }],
  kolonlar: [
    { alan: "unvan", baslik: "Ünvan", tip: "metin" },
    { alan: "tutar", baslik: "Tutar", tip: "para" },
  ],
  calistir: async () => [],
});

afterEach(() => _tumRaporlariTemizle());

describe("registerRapor / raporTanimlari (RPR-06)", () => {
  it("kaydeder, modüle göre süzer ve çift kaydı reddeder", () => {
    registerRapor(ornekTanim());
    expect(raporTanimiAl("test.ornek")?.ad).toBe("Örnek Rapor");
    expect(raporTanimlari("cari")).toHaveLength(1);
    expect(raporTanimlari("stok")).toHaveLength(0);
    expect(() => registerRapor(ornekTanim())).toThrow(/zaten kayıtlı/);
  });
});

describe("girdiDogrula", () => {
  it("geçerli girdiyi kabul eder", () => {
    const t = ornekTanim();
    expect(
      girdiDogrula(t, {
        filtreler: { cari: "abc", baslangic: "2026-01-01", adet: 5, yon: "cok" },
        gruplama: "ay",
        siralama: { alan: "tutar", yon: "desc" },
      }),
    ).toEqual([]);
  });

  it("zorunlu filtre eksikse hata döner", () => {
    const hatalar = girdiDogrula(ornekTanim(), { filtreler: {} });
    expect(hatalar.join(" ")).toContain("zorunlu");
  });

  it("bilinmeyen filtre, bozuk tarih ve geçersiz seçim reddedilir", () => {
    const hatalar = girdiDogrula(ornekTanim(), {
      filtreler: {
        cari: "abc",
        bilinmeyen: "x",
        baslangic: "01.01.2026",
        yon: "ters",
      },
    });
    expect(hatalar).toHaveLength(3);
  });

  it("tanımsız gruplama ve sıralama alanı reddedilir", () => {
    const hatalar = girdiDogrula(ornekTanim(), {
      filtreler: { cari: "abc" },
      gruplama: "hafta",
      siralama: { alan: "yok", yon: "asc" },
    });
    expect(hatalar).toHaveLength(2);
  });
});

describe("siralamaUygula", () => {
  it("para kolonunu sayısal, metin kolonunu yerelli sıralar", () => {
    const t = ornekTanim();
    const satirlar = [
      { unvan: "Çelik", tutar: "9.00" },
      { unvan: "Ada", tutar: "100.00" },
      { unvan: "Beta", tutar: "25.50" },
    ];
    const paraSirali = siralamaUygula(t, satirlar, { alan: "tutar", yon: "desc" });
    expect(paraSirali.map((s) => s.tutar)).toEqual(["100.00", "25.50", "9.00"]);
    const metinSirali = siralamaUygula(t, satirlar, { alan: "unvan", yon: "asc" });
    expect(metinSirali.map((s) => s.unvan)).toEqual(["Ada", "Beta", "Çelik"]);
  });

  it("sıralama verilmezse sırayı korur", () => {
    const satirlar = [{ unvan: "b", tutar: "1" }, { unvan: "a", tutar: "2" }];
    expect(siralamaUygula(ornekTanim(), satirlar)).toEqual(satirlar);
  });
});
