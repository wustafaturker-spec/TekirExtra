import { describe, expect, it } from "vitest";
import { csvUret, dosyaSatirlari, latinlestir, odemeDosyaProfiliSemasi, pain001Uret, VARSAYILAN_PROFIL, type DosyaTalimati } from "./odeme-dosyasi";

const talimat = (ek: Partial<DosyaTalimati> = {}): DosyaTalimati => ({
  no: "OT2026-000001", aliciUnvan: "Ege Ambalaj Ltd. Şti.", aliciIban: "TR33 0006 1005 1978 6457 8413 26", tutar: "12500.5", dovizCinsi: "TRY",
  aciklama: "ALS-12 fatura ödemesi", odemeTarihi: "2026-10-05", aliciVkn: "1234567890", aliciBanka: "İş Bankası", ...ek,
});

describe("toplu ödeme dosyası (ENT-07)", () => {
  it("genel Excel başlık satırı ve biçimli hücreler üretir; referans açıklamanın başına yazılır", () => {
    const [baslik, satir] = dosyaSatirlari([talimat()], VARSAYILAN_PROFIL);
    expect(baslik).toEqual(["Sıra", "Alıcı adı", "IBAN", "Tutar", "Döviz", "Açıklama", "Referans", "Ödeme tarihi"]);
    expect(satir).toEqual(["1", "Ege Ambalaj Ltd. Şti.", "TR330006100519786457841326", "12500,50", "TL", "OT2026-000001 ALS-12 fatura ödemesi", "OT2026-000001", "05.10.2026"]);
  });

  it("CSV profilinde ayraç, nokta ondalık, tarih biçimi ve açıklama sınırı uygulanır", () => {
    const profil = odemeDosyaProfiliSemasi.parse({
      bicim: "csv", ayrac: ",", ondalik: ".", tarihBicimi: "YYYYAAGG", baslikSatiri: false, aciklamaUzunlugu: 20,
      sutunlar: [{ alan: "aliciIban", baslik: "" }, { alan: "tutar", baslik: "" }, { alan: "odemeTarihi", baslik: "" }, { alan: "aciklama", baslik: "" }, { alan: "aliciUnvan", baslik: "" }],
    });
    expect(csvUret([talimat({ aliciUnvan: 'Ege, "Ambalaj"' })], profil)).toBe('TR330006100519786457841326,12500.50,20261005,OT2026-000001 ALS-12,"Ege, ""Ambalaj"""\r\n');
  });

  it("Excel/CSV profili sütunsuz olamaz", () => {
    expect(odemeDosyaProfiliSemasi.safeParse({ bicim: "csv", sutunlar: [] }).success).toBe(false);
    expect(odemeDosyaProfiliSemasi.safeParse({ bicim: "pain001" }).success).toBe(true);
  });

  it("pain.001 ödeme tarihine göre blok ayırır, toplamları ve EndToEndId'yi yazar, Türkçe harfleri sadeleştirir", () => {
    const xml = pain001Uret({
      paketNo: "OPK2026-000001", olusturma: new Date("2026-10-02T10:00:00Z"), firmaUnvan: "Tekir Ektra Ön Muhasebe A.Ş.", firmaVkn: "1234567801",
      borcluIban: "TR120001000000000000000001", bic: "TCZBTR2A",
      talimatlar: [talimat(), talimat({ no: "OT2026-000002", tutar: "100", odemeTarihi: "2026-10-06" }), talimat({ no: "OT2026-000003", tutar: "0.1" })],
    });
    expect(xml).toContain("<NbOfTxs>3</NbOfTxs>");
    expect(xml).toContain("<CtrlSum>12600.60</CtrlSum>");
    expect(xml.match(/<PmtInf>/g)).toHaveLength(2);
    expect(xml).toContain("<ReqdExctnDt>2026-10-05</ReqdExctnDt>");
    expect(xml).toContain("<EndToEndId>OT2026-000002</EndToEndId>");
    expect(xml).toContain('<InstdAmt Ccy="TRY">12500.50</InstdAmt>');
    expect(xml).toContain("<Nm>Tekir Ektra On Muhasebe A.S.</Nm>");
    expect(xml).toContain("<BIC>TCZBTR2A</BIC>");
  });

  it("latinleştirme Türkçe harfleri ve izinsiz karakterleri temizler", () => {
    expect(latinlestir("Çağlar Şık & Öğüt İnşaat")).toBe("Caglar Sik Ogut Insaat");
  });
});
