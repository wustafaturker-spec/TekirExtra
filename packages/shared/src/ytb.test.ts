import { describe, expect, it } from "vitest";
import { vazgecilenKdv, ytbBelgesiMi, ytbEngelleri, ytbFaturaTipi, ytbHarcamaTipiBul } from "./ytb";

// Kurallar GİB "Yatırım Teşvik Kapsamında Yapılan Teslimlere İlişkin Fatura
// Teknik Kılavuzu" v1.2'den (Ocak 2026).
const makineSatiri = {
  sira: 1,
  harcamaTipi: "01",
  makineAdi: "CNC Torna",
  makineId: "412578",
  makineSiraNo: "74563",
  kdvOrani: 20,
  gibIstisnaKodu: null as string | null,
};

const belge = (satirlar: (typeof makineSatiri)[]) => ({
  ytbNo: "123456",
  ytbTarihi: "2026-01-01",
  satirlar,
});

describe("ytbBelgesiMi (EBLG-78)", () => {
  it("teşvik numarası girilen fatura YTB kapsamındadır", () => {
    expect(ytbBelgesiMi("123456")).toBe(true);
    expect(ytbBelgesiMi("  ")).toBe(false);
    expect(ytbBelgesiMi(null)).toBe(false);
  });

  it("numara yoksa hiçbir kural çalışmaz", () => {
    expect(ytbEngelleri({ ytbNo: null, satirlar: [{ ...makineSatiri, harcamaTipi: null }] })).toEqual([]);
  });
});

describe("ytbFaturaTipi (EBLG-78)", () => {
  it("e-Faturada tip olduğu gibi kalır", () => {
    expect(ytbFaturaTipi("SATIS", "efatura")).toBe("SATIS");
    expect(ytbFaturaTipi("ISTISNA", "efatura")).toBe("ISTISNA");
  });

  it("e-Arşiv'e düşen belgede tipin başına YTB gelir", () => {
    expect(ytbFaturaTipi("SATIS", "earsiv")).toBe("YTBSATIS");
    expect(ytbFaturaTipi("ISTISNA", "earsiv")).toBe("YTBISTISNA");
    expect(ytbFaturaTipi("TEVKIFAT", "earsiv")).toBe("YTBTEVKIFAT");
    expect(ytbFaturaTipi("TEVKIFATIADE", "earsiv")).toBe("YTBTEVKIFATIADE");
    expect(ytbFaturaTipi("IADE", "earsiv")).toBe("YTBIADE");
  });

  it("YTB senaryosunda tanımsız tipe önek eklemez", () => {
    // OZELMATRAH, SGK gibi tipler YTB senaryosunda kullanılmaz.
    expect(ytbFaturaTipi("OZELMATRAH", "earsiv")).toBe("OZELMATRAH");
  });
});

describe("ytbEngelleri (EBLG-78)", () => {
  it("eksiksiz makine-teçhizat faturasını geçirir", () => {
    expect(ytbEngelleri(belge([makineSatiri]))).toEqual([]);
  });

  it("teşvik belge tarihi zorunludur", () => {
    expect(ytbEngelleri({ ...belge([makineSatiri]), ytbTarihi: null }).map((e) => e.alan)).toContain("ytbTarihi");
  });

  it("hiçbir satırda harcama tipi yoksa durdurur", () => {
    const engeller = ytbEngelleri(belge([{ ...makineSatiri, harcamaTipi: null }]));

    expect(engeller.map((e) => e.alan)).toContain("harcamaTipi");
  });

  it("tanımsız harcama tipini reddeder", () => {
    const engeller = ytbEngelleri(belge([makineSatiri, { ...makineSatiri, sira: 2, harcamaTipi: "09" }]));

    expect(engeller.some((e) => e.satirIndeksi === 1 && e.mesaj.includes("tanımsız"))).toBe(true);
  });

  it("makine-teçhizat satırında makine adı, ID ve sıra no ister", () => {
    const engeller = ytbEngelleri(belge([{ ...makineSatiri, makineAdi: null, makineId: null, makineSiraNo: null }]));

    expect(engeller.map((e) => e.alan).sort()).toEqual(["makineAdi", "makineId", "makineSiraNo"]);
  });

  it("makine bilgisi yalnız harcama tipi 01'de aranır", () => {
    const insaat = { ...makineSatiri, harcamaTipi: "02", makineAdi: null, makineId: null, makineSiraNo: null };

    expect(ytbEngelleri(belge([insaat]))).toEqual([]);
  });

  it("KDV'siz makine satırında istisna kodu 308 olmalıdır", () => {
    const kdvsiz = { ...makineSatiri, kdvOrani: 0, gibIstisnaKodu: "339" };

    expect(ytbEngelleri(belge([kdvsiz]))[0].mesaj).toContain("308");
    expect(ytbEngelleri(belge([{ ...kdvsiz, gibIstisnaKodu: "308" }]))).toEqual([]);
  });

  it("KDV'siz inşaat satırında istisna kodu 339 olmalıdır", () => {
    const insaat = { ...makineSatiri, harcamaTipi: "02", kdvOrani: 0, gibIstisnaKodu: "308", makineAdi: null, makineId: null, makineSiraNo: null };

    expect(ytbEngelleri(belge([insaat]))[0].mesaj).toContain("339");
    expect(ytbEngelleri(belge([{ ...insaat, gibIstisnaKodu: "339" }]))).toEqual([]);
  });

  it("arsa/arazi ve diğer harcamalar KDV'siz düzenlenemez", () => {
    for (const kod of ["03", "04"]) {
      const satir = { ...makineSatiri, harcamaTipi: kod, kdvOrani: 0, gibIstisnaKodu: "308", makineAdi: null, makineId: null, makineSiraNo: null };

      expect(ytbEngelleri(belge([satir]))[0].mesaj).toContain("KDV'siz düzenlenemez");
      expect(ytbEngelleri(belge([{ ...satir, kdvOrani: 20, gibIstisnaKodu: null }]))).toEqual([]);
    }
  });
});

describe("harcama tipleri ve vazgeçilen KDV", () => {
  it("harcama tipi istisna kodunu ve KDV'siz düzenlenebilirliği taşır", () => {
    expect(ytbHarcamaTipiBul("01")).toMatchObject({ istisnaKodu: "308", kdvsizOlabilir: true });
    expect(ytbHarcamaTipiBul("03")).toMatchObject({ istisnaKodu: null, kdvsizOlabilir: false });
    expect(ytbHarcamaTipiBul("99")).toBeUndefined();
  });

  it("vazgeçilen KDV kuruşta yuvarlanır", () => {
    expect(vazgecilenKdv(1500, 20)).toBe(300);
    expect(vazgecilenKdv(33.33, 20)).toBe(6.67);
    expect(vazgecilenKdv(1500, 0)).toBe(0);
  });
});
