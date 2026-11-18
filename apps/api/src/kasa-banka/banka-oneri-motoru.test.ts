import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { bankaOnerisiUret, type BankaOneriGirdisi } from "./banka-oneri-motoru";

const D = (v: number | string) => new Prisma.Decimal(v);

describe("P-05 Banka Öneri Motoru (banka-oneri-motoru)", () => {
  const temelSatir: BankaOneriGirdisi["satir"] = {
    id: "satir-1",
    tarih: new Date("2026-11-18"),
    tutar: D(1500),
    aciklama: "HAVALE",
    karsiIban: null,
    karsiUnvan: null,
    bankaHesapId: "bhesap-1",
    dovizCinsi: "TRY",
  };

  it("açıklamadaki fatura no (+40), unvan (+25) ve tutar tam uyumu (+20) ile skor >= 85 üretir", () => {
    const girdi: BankaOneriGirdisi = {
      satir: {
        ...temelSatir,
        aciklama: "GELEN HAVALE - ACME TEKSTIL SANAYI - FATURA NO: ACM2026000000123",
      },
      cariler: [
        { id: "c1", kod: "C001", unvan: "ACME TEKSTİL SAN. TİC. LTD. ŞTİ.", vknTckn: "1234567890" },
        { id: "c2", kod: "C002", unvan: "KAYA İNŞAAT A.Ş.", vknTckn: "9876543210" },
      ],
      faturalar: [
        { id: "f1", cariId: "c1", no: "ACM2026000000123", tarih: "2026-11-01", vadeTarihi: "2026-11-15", dovizCinsi: "TRY", kalan: "1500.00", genelToplam: "1500.00" },
      ],
    };

    const sonuc = bankaOnerisiUret(girdi);
    expect(sonuc.skor).toBeGreaterThanOrEqual(85);
    expect(sonuc.onerilenCari?.id).toBe("c1");
    expect(sonuc.sinyaller.some((s) => s.tur === "fatura_no")).toBe(true);
    expect(sonuc.sinyaller.some((s) => s.tur === "tutar")).toBe(true);
    expect(sonuc.dagitimPlani).toEqual([{ faturaId: "f1", tutar: "1500.00", faturaNo: "ACM2026000000123" }]);
  });

  it("açıklamadaki VKN/TCKN (+30) ve IBAN (+35) eşleştiğinde skoru yükseltir", () => {
    const girdi: BankaOneriGirdisi = {
      satir: {
        ...temelSatir,
        karsiIban: "TR330006100511123456789012",
        aciklama: "EFT VKN: 1234567890 ODEME",
      },
      cariler: [
        { id: "c1", kod: "C001", unvan: "ACME TEKSTİL", vknTckn: "1234567890", iban: "TR330006100511123456789012" },
      ],
      faturalar: [],
    };

    const sonuc = bankaOnerisiUret(girdi);
    expect(sonuc.skor).toBe(65); // 35 (iban) + 30 (vkn)
    expect(sonuc.onerilenCari?.id).toBe("c1");
    expect(sonuc.sinyaller.find((s) => s.tur === "iban")?.puan).toBe(35);
    expect(sonuc.sinyaller.find((s) => s.tur === "vkn_tckn")?.puan).toBe(30);
  });

  it("iki yakın/benzer aday çıktığında seçim ister ve alternatifAdaylar döner", () => {
    const girdi: BankaOneriGirdisi = {
      satir: {
        ...temelSatir,
        aciklama: "GELEN EFT - OZCAN OTOMOTIV ODEMESI",
      },
      cariler: [
        { id: "c1", kod: "C001", unvan: "ÖZCAN OTOMOTİV SANAYİ TİCARET L", tip: "alici" },
        { id: "c2", kod: "C002", unvan: "ÖZCAN OTOMOTİV SERVİS HİZMETLERİ", tip: "alici" },
      ],
      faturalar: [
        { id: "f1", cariId: "c1", no: "OZC2026000000001", tarih: "2026-11-01", vadeTarihi: null, dovizCinsi: "TRY", kalan: "1500.00", genelToplam: "1500.00" },
        { id: "f2", cariId: "c2", no: "OZC2026000000002", tarih: "2026-11-01", vadeTarihi: null, dovizCinsi: "TRY", kalan: "1500.00", genelToplam: "1500.00" },
      ],
    };

    const sonuc = bankaOnerisiUret(girdi);
    expect(sonuc.oneriTuru).toBe("belirsiz");
    expect(sonuc.alternatifAdaylar).toBeDefined();
    expect(sonuc.alternatifAdaylar?.length).toBe(2);
    expect(sonuc.aciklama).toContain("Birden fazla yakın cari adayı tespit edildi");
  });

  it("kayıtlı kural (masraf/gelir/virman) varsa önceliklendirilir", () => {
    const girdi: BankaOneriGirdisi = {
      satir: {
        ...temelSatir,
        tutar: D(-50), // Giden para
        aciklama: "BSMV VE EFT ISLEM MASRAFI",
      },
      kurallar: [
        { id: "k1", anahtar: "eft islem masrafi", eslesmeTuru: "masraf", masrafKategoriId: "kat-masraf-1", bankaHesapId: null, yon: "cikis", aktif: true, cariId: null, gelirKategoriId: null, hedefKasaId: null, hedefBankaHesapId: null },
      ],
      cariler: [],
      faturalar: [],
    };

    const sonuc = bankaOnerisiUret(girdi);
    expect(sonuc.skor).toBe(95);
    expect(sonuc.onerilenTur).toBe("masraf");
    expect(sonuc.kuralId).toBe("k1");
  });

  it("açıklamada geçen ödeme talimatı ve tutar tam uyumu durumunda skor 98 üretir", () => {
    const girdi: BankaOneriGirdisi = {
      satir: {
        ...temelSatir,
        tutar: D(-12000),
        aciklama: "TALIMAT NO: TAL20260012 VERGI ODEMESI",
      },
      odemeTalimatlari: [
        { id: "t1", no: "TAL20260012", aliciUnvan: "KADIKÖY VD.", tutar: D(12000), aciklamadaGeciyor: true },
      ],
      cariler: [],
      faturalar: [],
    };

    const sonuc = bankaOnerisiUret(girdi);
    expect(sonuc.skor).toBe(98);
    expect(sonuc.onerilenTur).toBe("odeme_talimati");
    expect(sonuc.eslesenTalimat?.no).toBe("TAL20260012");
  });
});
