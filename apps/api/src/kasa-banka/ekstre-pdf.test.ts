import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bakiyeSaglamasi, pdfEkstreOku, pdfMi } from "./ekstre-pdf";
import { ekstreSatirlariOku, eslemeTahminEt } from "./ekstre-oku";
import { pdfUret, sagaYasla, type Yazi } from "./ekstre-pdf.test-veri";

const oku = async (pdf: Buffer) => {
  const sonuc = await pdfEkstreOku(pdf);
  const esleme = eslemeTahminEt(sonuc.tablo[0]);
  return { ...sonuc, esleme, ...ekstreSatirlariOku(sonuc.tablo, esleme) };
};

/** Tek satırlık hareketler (Garanti düzeni): yeniden eskiye, işaretli tutar. */
function tekSatirli(hareketler: [string, string, string, string][], basla = 120): Yazi[] {
  const y: Yazi[] = [
    { x: 31, y: basla, metin: "Tarih" }, { x: 88, y: basla, metin: "Aciklama" }, { x: 315, y: basla, metin: "Etiket" },
    { x: 460, y: basla, metin: "Tutar" }, { x: 541, y: basla, metin: "Bakiye" },
  ];
  hareketler.forEach(([tarih, aciklama, tutar, bakiye], i) => {
    const sy = basla + 16 + i * 14;
    y.push({ x: 31, y: sy, metin: tarih }, { x: 88, y: sy, metin: aciklama }, { x: 315, y: sy, metin: "Para Transferi" },
      { x: sagaYasla(tutar, 479), y: sy, metin: tutar }, { x: sagaYasla(bakiye, 564), y: sy, metin: bakiye });
  });
  return y;
}

describe("KSB-34 PDF banka ekstresi", () => {
  it("tek satırlı düzen: başlık tekrarı, sayfa altı yazısı ve hesap IBAN'ı", async () => {
    const ust: Yazi[] = [
      { x: 30, y: 60, metin: "IBAN" }, { x: 109, y: 60, metin: ": TR79 0006 2000 0620 0006 6916 98" },
      { x: 30, y: 80, metin: "Sayin Musteri, 01/01/2026 - 30/10/2026 tarihleri arasindaki hareketleriniz" },
    ];
    const altBilgi = (no: string): Yazi[] => [{ x: 30, y: 790, metin: "Ornek Bankasi A.S." }, { x: 544, y: 790, metin: no }];
    const pdf = pdfUret([
      [...ust, ...tekSatirli([
        ["27.09.2026", "QR ILE P.CEKME-ATM Kodu:00924", "-2.000,00 TL", "6,42 TL"],
        ["27.09.2026", "AHMET YILMAZ-FAST-5652724", "+2.000,00 TL", "2.006,42 TL"],
      ]), ...altBilgi("1 / 2")],
      [...tekSatirli([["23.09.2026", "AYSE KAYA-FAST-9813433", "+500,00 TL", "6,42 TL"]], 100), ...altBilgi("2 / 2")],
    ]);
    expect(pdfMi(pdf)).toBe(true);
    const r = await oku(pdf);
    expect(r.sayfaSayisi).toBe(2);
    expect(r.ustIbanlar).toEqual(["TR790006200006200006691698"]);
    expect(r.tablo[0]).toEqual(["Tarih", "Aciklama", "Etiket", "Tutar", "Bakiye"]);
    expect(r.esleme).toMatchObject({ tarih: 0, aciklama: 1, tutar: 3, bakiye: 4 });
    expect(r.satirlar.map((s) => [s.tarih.toISOString().slice(0, 10), s.tutar, s.aciklama, s.bakiye])).toEqual([
      ["2026-09-27", -2000, "QR ILE P.CEKME-ATM Kodu:00924", 6.42],
      ["2026-09-27", 2000, "AHMET YILMAZ-FAST-5652724", 2006.42],
      ["2026-09-23", 500, "AYSE KAYA-FAST-9813433", 6.42],
    ]);
    // Yeniden eskiye sıralı ekstrede sağlama ters yönde yapılır: 6,42 + 2.000 = 2.006,42.
    expect(bakiyeSaglamasi(r.satirlar.slice(0, 2)).tutarsizlar).toEqual([]);
  });

  it("açıklama tarih satırının üstünde (YKB düzeni) ise sonraki harekete eklenir", async () => {
    const y: Yazi[] = [
      { x: 28, y: 100, metin: "Tarih" }, { x: 85, y: 100, metin: "Saat" }, { x: 276, y: 100, metin: "Aciklama" },
      { x: 452, y: 100, metin: "Islem Tutari" }, { x: 542, y: 100, metin: "Bakiye" },
    ];
    const hareket = (sy: number, aciklama: string[], tarih: string, tutar: string, bakiye: string) => {
      aciklama.slice(0, -1).forEach((m, i) => y.push({ x: 276, y: sy - (aciklama.length - 1 - i) * 14, metin: m }));
      y.push({ x: 28, y: sy, metin: tarih }, { x: 85, y: sy, metin: "14:50:34" }, { x: 276, y: sy, metin: aciklama.at(-1)! },
        { x: sagaYasla(tutar, 496), y: sy, metin: tutar }, { x: sagaYasla(bakiye, 567), y: sy, metin: bakiye });
    };
    hareket(141, ["BSMV ELEKTRONIK FON", "TRANSFERI UCRETI", "YKB DEN KUVEYT"], "10/07/2026", "-0,80 TL", "311,45 TL");
    hareket(183, ["GIDEN FAST - KA GRUP", "HESABINA VIRMAN"], "10/07/2026", "-19.500,00 TL", "312,25 TL");
    hareket(197, ["QR Para Cekme ATM 107844"], "21/06/2026", "-1.000,00 TL", "19.812,25 TL");
    y.push({ x: 30, y: 800, metin: "Ornek Bankasi A.S." }, { x: 551, y: 806, metin: "1/1" });
    const r = await oku(pdfUret([y]));
    expect(r.satirlar.map((s) => [s.aciklama, s.tutar])).toEqual([
      ["BSMV ELEKTRONIK FON TRANSFERI UCRETI YKB DEN KUVEYT", -0.8],
      ["GIDEN FAST - KA GRUP HESABINA VIRMAN", -19500],
      ["QR Para Cekme ATM 107844", -1000],
    ]);
    expect(bakiyeSaglamasi(r.satirlar).tutarsizlar).toEqual([]);
  });

  it("çok satırlı başlık ve dikey ortalanmış hareket (Kuveyt Türk düzeni)", async () => {
    const y: Yazi[] = [
      { x: 332, y: 40, metin: "IBAN:" }, { x: 448, y: 40, metin: "TR73 0020 5000 0030 0123 9000 12" },
      { x: 38, y: 220, metin: "Islem" }, { x: 80, y: 220, metin: "Referans" },
      { x: 309, y: 225, metin: "Aciklama" }, { x: 535, y: 225, metin: "Tutar" }, { x: 564, y: 225, metin: "Bakiye" },
      { x: 38, y: 230, metin: "Tarihi" }, { x: 85, y: 230, metin: "Kodu" },
      { x: 71, y: 255, metin: "Devir Bakiyesi" }, { x: sagaYasla("4.321,99", 588), y: 255, metin: "4.321,99" },
    ];
    const hareket = (sy: number, tarih: string, ref: string, ust: string | null, orta: string | null, alt: string | null, tutar: string, bakiye: string) => {
      if (ust) y.push({ x: 122, y: sy - 5.3, metin: ust });
      y.push({ x: 553, y: sy - 5.3, metin: "-" });
      y.push({ x: 29, y: sy, metin: tarih }, { x: 82, y: sy, metin: ref }, { x: sagaYasla(bakiye, 588), y: sy, metin: bakiye });
      if (orta) y.push({ x: 122, y: sy, metin: orta });
      if (alt) y.push({ x: 122, y: sy + 5.5, metin: alt });
      y.push({ x: sagaYasla(tutar, 556), y: sy + 5.5, metin: tutar });
    };
    hareket(285, "28.10.2026", "A00AN", null, "ATM'den QR Kod ile Nakit Cekme", null, "500,00", "3.821,99");
    hareket(320, "30.10.2026", "A006D", "Tesisat No:5327962170,Kurum Adi:VODAFONE,Odeme", null, "Kanali:EOD", "383,25", "3.438,74");
    hareket(355, "30.10.2026", "A007N", "Tesisat No:5337401764,Kurum Adi:VODAFONE,Odeme", null, "Kanali:EOD", "336,50", "3.102,24");
    y.push({ x: 82, y: 390, metin: "Toplam" }, { x: sagaYasla("3.102,24", 588), y: 390, metin: "3.102,24" });
    const r = await oku(pdfUret([y]));
    expect(r.tablo[0]).toEqual(["Islem Tarihi", "Referans Kodu", "Aciklama", "Tutar", "Bakiye"]);
    expect(r.ustIbanlar).toEqual(["TR730020500000300123900012"]);
    expect(r.esleme).toMatchObject({ tarih: 0, dekontNo: 1, aciklama: 2, tutar: 3, bakiye: 4 });
    expect(r.satirlar.map((s) => [s.dekontNo, s.aciklama, s.tutar, s.bakiye])).toEqual([
      ["A00AN", "ATM'den QR Kod ile Nakit Cekme", -500, 3821.99],
      ["A006D", "Tesisat No:5327962170,Kurum Adi:VODAFONE,Odeme Kanali:EOD", -383.25, 3438.74],
      ["A007N", "Tesisat No:5337401764,Kurum Adi:VODAFONE,Odeme Kanali:EOD", -336.5, 3102.24],
    ]);
    // Devir ve Toplam satırları harekete karışmaz, eşlemede atlanır.
    expect(r.atlanan).toBe(2);
    expect(bakiyeSaglamasi(r.satirlar)).toEqual({ denetlenen: 2, tutarsizlar: [] });
  });

  it("bakiye sağlaması yanlış okunan satırı gösterir", () => {
    const satir = (tutar: number, bakiye: number) => ({ tarih: new Date("2026-10-01"), tutar, bakiye, aciklama: "x", satirOzeti: "" });
    expect(bakiyeSaglamasi([satir(100, 100), satir(50, 150), satir(-20, 140)]).tutarsizlar).toEqual([
      { tarih: "2026-10-01", tutar: "-20.00", bakiye: "140.00", beklenen: "130.00", aciklama: "x" },
    ]);
    expect(bakiyeSaglamasi([satir(100, 100)])).toEqual({ denetlenen: 0, tutarsizlar: [] });
  });

  it("yazısız (taranmış) PDF, başlıksız PDF ve 200 sayfayı aşan PDF reddedilir", async () => {
    await expect(pdfEkstreOku(pdfUret([[]]))).rejects.toThrow("taranmış");
    await expect(pdfEkstreOku(pdfUret([[{ x: 30, y: 60, metin: "Sayin musterimiz, bu belge bilgilendirme amaclidir." }]]))).rejects.toThrow("başlık satırı");
    const sayfa: Yazi[] = [{ x: 30, y: 60, metin: "Tarih" }, { x: 100, y: 60, metin: "Aciklama" }, { x: 300, y: 60, metin: "Tutar" }];
    await expect(pdfEkstreOku(pdfUret(Array.from({ length: 201 }, () => sayfa)))).rejects.toThrow("en çok 200");
    await expect(pdfEkstreOku(Buffer.from("%PDF-1.4\nbozuk"))).rejects.toThrow("PDF okunamadı");
  });

  // Gerçek banka çıktıları kişisel veri taşır, repoda yoktur; geliştirici makinesinde docs/Ekstre altındaysa denenir.
  const ornekler = join(__dirname, "../../../../docs/Ekstre");
  const gercek: [string, number, number][] = [
    ["Belge-2026-10-30-19-47-30.pdf", 37, 36],
    ["YKB BNK N6-7-2026 TL.pdf", 10, 9],
    ["HesapEkstresi.pdf", 7, 6],
  ];
  for (const [dosya, hareket, denetlenen] of gercek) {
    it.skipIf(!existsSync(join(ornekler, dosya)))(`gerçek örnek: ${dosya}`, async () => {
      const r = await oku(readFileSync(join(ornekler, dosya)));
      expect(r.satirlar).toHaveLength(hareket);
      expect(bakiyeSaglamasi(r.satirlar)).toMatchObject({ denetlenen, tutarsizlar: [] });
    });
  }
});
