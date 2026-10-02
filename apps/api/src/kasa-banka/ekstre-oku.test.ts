import { describe, expect, it } from "vitest";
import {
  ekstreSatirlariOku,
  ekstreTabloOku,
  eslemeTahminEt,
  tarihCoz,
  tutarCoz,
} from "./ekstre-oku";

describe("tutarCoz (KSB-06)", () => {
  it("TR ve EN sayı biçimlerini ayırt eder", () => {
    expect(tutarCoz("1.234,56")).toBe(1234.56); // TR: nokta binlik
    expect(tutarCoz("1,234.56")).toBe(1234.56); // EN: virgül binlik
    expect(tutarCoz("1234.56")).toBe(1234.56);
    expect(tutarCoz("12,5")).toBe(12.5); // tek virgül, 1 hane → ondalık
    expect(tutarCoz("1,234")).toBe(1234); // tek virgül, 3 hane → binlik
    expect(tutarCoz("750")).toBe(750);
  });

  it("eksi işaretini üç yazımdan da okur", () => {
    expect(tutarCoz("-1.234,56")).toBe(-1234.56);
    expect(tutarCoz("(1.234,56)")).toBe(-1234.56); // muhasebe biçimi
    expect(tutarCoz("-750 TL")).toBe(-750);
  });

  it("para birimi ekini ve boşluğu temizler", () => {
    expect(tutarCoz("1.500,00 TL")).toBe(1500);
    expect(tutarCoz("2.000,00 ₺")).toBe(2000);
    expect(tutarCoz("  350,25  ")).toBe(350.25);
  });

  it("boş ve sayısal olmayan değerde null döner", () => {
    expect(tutarCoz("")).toBeNull();
    expect(tutarCoz("TOPLAM")).toBeNull();
  });
});

describe("tarihCoz (KSB-06)", () => {
  it("yaygın üç biçimi okur", () => {
    expect(tarihCoz("15.07.2026")?.toISOString().slice(0, 10)).toBe("2026-07-15");
    expect(tarihCoz("15/07/2026")?.toISOString().slice(0, 10)).toBe("2026-07-15");
    expect(tarihCoz("2026-07-15")?.toISOString().slice(0, 10)).toBe("2026-07-15");
  });

  it("saat ekini yok sayar ve 2 haneli yılı 2000'li kabul eder", () => {
    expect(tarihCoz("15.07.2026 14:32:11")?.toISOString().slice(0, 10)).toBe("2026-07-15");
    expect(tarihCoz("15.07.26")?.toISOString().slice(0, 10)).toBe("2026-07-15");
  });

  it("geçersiz değerde null döner", () => {
    expect(tarihCoz("Hesap Özeti")).toBeNull();
    expect(tarihCoz("32.13.2026")).toBeNull();
  });
});

describe("ekstreTabloOku (KSB-06)", () => {
  it("noktalı virgüllü dosyayı ve tırnaklı alanları böler", () => {
    const csv = 'Tarih;Açıklama;Tutar\n15.07.2026;"HAVALE; ABC LTD";1.000,00\n';
    const tablo = ekstreTabloOku(Buffer.from(csv, "utf-8"));
    expect(tablo[0]).toEqual(["Tarih", "Açıklama", "Tutar"]);
    // Tırnak içindeki ayırıcı alanı bölmemeli
    expect(tablo[1]).toEqual(["15.07.2026", "HAVALE; ABC LTD", "1.000,00"]);
  });

  it("virgülle ayrılmış dosyayı da tanır", () => {
    const csv = "Date,Description,Amount\n2026-07-15,PAYMENT,100.00\n";
    const tablo = ekstreTabloOku(Buffer.from(csv, "utf-8"));
    expect(tablo[1]).toEqual(["2026-07-15", "PAYMENT", "100.00"]);
  });
});

describe("eslemeTahminEt (KSB-06)", () => {
  it("Türkçe başlıklardan sütunları bulur", () => {
    const e = eslemeTahminEt(["İşlem Tarihi", "Açıklama", "Tutar", "Bakiye"]);
    expect(e.tarih).toBe(0);
    expect(e.aciklama).toBe(1);
    expect(e.tutar).toBe(2);
    expect(e.bakiye).toBe(3);
  });

  it("borç/alacak ikilisi varsa tek tutar sütunu aramaz", () => {
    const e = eslemeTahminEt(["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye"]);
    expect(e.borc).toBe(2);
    expect(e.alacak).toBe(3);
    expect(e.tutar).toBeNull();
  });

  it("Türkçe küçültmede noktasız ı üreten başlıkları da yakalar", () => {
    // "IBAN".toLocaleLowerCase("tr") → "ıban"; ASCII'ye indirgeme olmadan kaçıyordu
    const e = eslemeTahminEt(["Islem Tarihi", "Aciklama", "Tutar", "Karsi IBAN"]);
    expect(e.karsiIban).toBe(3);
    expect(e.tarih).toBe(0);
    expect(e.aciklama).toBe(1);
  });

  it("aksanlı ve aksansız yazımı aynı sayar", () => {
    const e = eslemeTahminEt(["İşlem Tarihi", "Açıklama", "Tutar", "Karşı Ünvan"]);
    expect(e.tarih).toBe(0);
    expect(e.aciklama).toBe(1);
    expect(e.karsiUnvan).toBe(3);
  });
});

describe("ekstreSatirlariOku (KSB-06)", () => {
  const tablo = [
    ["Tarih", "Açıklama", "Tutar", "Bakiye"],
    ["15.07.2026", "ABC LTD HAVALE", "1.000,00", "5.000,00"],
    ["16.07.2026", "EFT MASRAFI", "-25,50", "4.974,50"],
    ["Toplam", "", "", ""], // veri olmayan satır
  ];

  it("işaretli tutar sütununu okur, veri olmayan satırı atlar", () => {
    const { satirlar, atlanan } = ekstreSatirlariOku(tablo, {
      baslikSatiri: 0,
      tarih: 0,
      aciklama: 1,
      tutar: 2,
      bakiye: 3,
    });

    expect(satirlar).toHaveLength(2);
    expect(atlanan).toBe(1);
    expect(satirlar[0].tutar).toBe(1000);
    expect(satirlar[1].tutar).toBe(-25.5); // çıkış eksi kalır
    expect(satirlar[0].bakiye).toBe(5000);
  });

  it("ayrı borç/alacak sütunlarından yönü kurar", () => {
    const ayriTablo = [
      ["Tarih", "Açıklama", "Borç", "Alacak"],
      ["15.07.2026", "TAHSİLAT", "", "1.000,00"],
      ["16.07.2026", "ÖDEME", "500,00", ""],
    ];
    const { satirlar } = ekstreSatirlariOku(ayriTablo, {
      baslikSatiri: 0,
      tarih: 0,
      aciklama: 1,
      borc: 2,
      alacak: 3,
    });

    expect(satirlar[0].tutar).toBe(1000); // alacak → giriş
    expect(satirlar[1].tutar).toBe(-500); // borç → çıkış
  });

  it("aynı gün/tutar/açıklamalı gerçek tekrarlara ayrı özet verir", () => {
    const tekrarli = [
      ["Tarih", "Açıklama", "Tutar"],
      ["15.07.2026", "EFT MASRAFI", "-25,50"],
      ["15.07.2026", "EFT MASRAFI", "-25,50"],
    ];
    const { satirlar } = ekstreSatirlariOku(tekrarli, {
      baslikSatiri: 0,
      tarih: 0,
      aciklama: 1,
      tutar: 2,
    });

    // İkisi de kaydedilebilmeli; teklik kısıtı gerçek tekrarı ezmemeli
    expect(satirlar).toHaveLength(2);
    expect(satirlar[0].satirOzeti).not.toBe(satirlar[1].satirOzeti);
    expect(satirlar[0].satirOzeti.endsWith("#1")).toBe(true);
    expect(satirlar[1].satirOzeti.endsWith("#2")).toBe(true);
  });

  it("aynı dosya iki kez okunduğunda özetler birebir aynı çıkar", () => {
    const esleme = { baslikSatiri: 0, tarih: 0, aciklama: 1, tutar: 2, bakiye: 3 };
    const bir = ekstreSatirlariOku(tablo, esleme).satirlar.map((s) => s.satirOzeti);
    const iki = ekstreSatirlariOku(tablo, esleme).satirlar.map((s) => s.satirOzeti);
    expect(bir).toEqual(iki);
  });
});

describe("Excel ekstresi (KSB-06)", () => {
  it(".xlsx dosyasını tarih ve tutar hücreleriyle birlikte tabloya çevirir", async () => {
    const { ekstreDosyasiOku, ekstreSatirlariOku, excelMi } = await import("./ekstre-oku");
    const ExcelJS = await import("exceljs");
    const kitap = new ExcelJS.Workbook();
    const sayfa = kitap.addWorksheet("Hesap Hareketleri");
    sayfa.addRow(["Tarih", "Açıklama", "Tutar", "Bakiye"]);
    sayfa.addRow([new Date(Date.UTC(2026, 9, 1)), "EFT ANADOLU KİMYA", 1500.5, 10500.5]);
    sayfa.addRow([new Date(Date.UTC(2026, 9, 2)), { richText: [{ text: "EFT " }, { text: "ÜCRETİ" }] }, -12.5, 10488]);
    const dosya = Buffer.from(await kitap.xlsx.writeBuffer());

    expect(excelMi(dosya)).toBe(true);
    const tablo = await ekstreDosyasiOku(dosya);
    expect(tablo[1]).toEqual(["2026-10-01", "EFT ANADOLU KİMYA", "1500.5", "10500.5"]);
    const { satirlar } = ekstreSatirlariOku(tablo, { baslikSatiri: 0, tarih: 0, aciklama: 1, tutar: 2, bakiye: 3 });
    expect(satirlar.map((s) => [s.tutar, s.aciklama])).toEqual([[1500.5, "EFT ANADOLU KİMYA"], [-12.5, "EFT ÜCRETİ"]]);
  });

  it("binlerce satırlık dosyayı doğrusal sürede okur (sütun sayısı bir kez hesaplanır)", async () => {
    const { ekstreDosyasiOku } = await import("./ekstre-oku");
    const ExcelJS = await import("exceljs");
    const kitap = new ExcelJS.Workbook();
    const sayfa = kitap.addWorksheet("Hareketler");
    sayfa.addRow(["Tarih", "Açıklama", "Tutar", "Bakiye"]);
    for (let i = 0; i < 6000; i++) sayfa.addRow([new Date(Date.UTC(2026, 0, 1 + (i % 300))), `EFT ${i}`, i, i * 2]);
    const dosya = Buffer.from(await kitap.xlsx.writeBuffer());
    const basla = Date.now();
    const tablo = await ekstreDosyasiOku(dosya);
    expect(tablo).toHaveLength(6001);
    expect(Date.now() - basla).toBeLessThan(5000);
  }, 20000);

  it("bozuk .xlsx için anlaşılır hata verir", async () => {
    const { ekstreDosyasiOku } = await import("./ekstre-oku");
    await expect(ekstreDosyasiOku(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).rejects.toThrow("Excel dosyası okunamadı");
  });
});
