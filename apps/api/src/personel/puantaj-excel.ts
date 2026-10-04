import * as ExcelJS from "exceljs";

/**
 * PRS-16 (P2-7): puantajın Excel şablonu ve okunması. Şablon dönemin
 * personeliyle ve kayıtlı değerlerle dolu gelir; kullanıcı yalnız sayıları
 * değiştirir. Eksik gün nedeni kod ya da Türkçe adıyla yazılabilir.
 */

export const EKSIK_GUN_ADLARI: Record<string, string> = {
  istirahat: "İstirahat", ucretsiz_izin: "Ücretsiz izin", disiplin: "Disiplin", gozaltina_alinma: "Gözaltı/tutukluluk",
  kismi_istihdam: "Kısmi istihdam", puantaj: "Puantaj", diger: "Diğer",
};

const KOLONLAR = [
  { baslik: "Personel no", anahtar: "personelNo", genislik: 14 },
  { baslik: "Ad soyad (bilgi)", anahtar: "adSoyad", genislik: 26 },
  { baslik: "İstihdam günü (bilgi)", anahtar: "istihdamGunu", genislik: 12 },
  { baslik: "Prim günü", anahtar: "primGunu", genislik: 10 },
  { baslik: "Eksik gün nedeni", anahtar: "eksikGunNedeni", genislik: 18 },
  { baslik: "Fazla mesai brüt", anahtar: "fazlaMesaiBrut", genislik: 14 },
  { baslik: "Prim / ikramiye brüt", anahtar: "primIkramiyeBrut", genislik: 14 },
  { baslik: "Nakit yemek yardımı", anahtar: "nakitYemekYardimi", genislik: 14 },
  { baslik: "Fiilî çalışma günü", anahtar: "fiiliCalismaGunu", genislik: 12 },
  { baslik: "Şahıs sigortası", anahtar: "sahisSigortaPrimi", genislik: 12 },
  { baslik: "Hayat sigortası", anahtar: "hayatSigortaPrimi", genislik: 12 },
  { baslik: "Sendika aidatı", anahtar: "sendikaAidati", genislik: 12 },
  { baslik: "Açıklama", anahtar: "aciklama", genislik: 30 },
] as const;

export type PuantajSatiri = Record<(typeof KOLONLAR)[number]["anahtar"], string | number | null>;

export async function puantajSablonu(yil: number, ay: number, satirlar: PuantajSatiri[]): Promise<Buffer> {
  const kitap = new ExcelJS.Workbook();
  const sayfa = kitap.addWorksheet(`Puantaj ${yil}-${String(ay).padStart(2, "0")}`);
  sayfa.columns = KOLONLAR.map((k) => ({ key: k.anahtar, width: k.genislik }));
  const baslik = sayfa.getRow(1);
  baslik.values = KOLONLAR.map((k) => k.baslik);
  baslik.font = { bold: true, color: { argb: "FFFFFFFF" } };
  baslik.eachCell((h) => { h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } }; });
  for (const s of satirlar) sayfa.addRow(s);
  sayfa.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];
  const notlar = kitap.addWorksheet("Açıklama");
  notlar.addRow(["Personel no değiştirilmemeli; bilgi sütunları okunmaz."]);
  notlar.addRow(["Prim günü istihdam gününden az ise eksik gün nedeni zorunludur. Nedenler:"]);
  for (const [kod, ad] of Object.entries(EKSIK_GUN_ADLARI)) notlar.addRow([kod, ad]);
  notlar.getColumn(1).width = 70;
  return Buffer.from(await kitap.xlsx.writeBuffer());
}

const metin = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "text" in v) return String(v.text);
  if (typeof v === "object" && "result" in v) return String(v.result ?? "");
  return String(v).trim();
};
const sayi = (v: ExcelJS.CellValue): number => { const m = metin(v).replace(",", "."); return m === "" ? 0 : Number(m); };

export function eksikGunKodu(deger: string): string | null {
  const v = deger.trim();
  if (!v) return null;
  if (EKSIK_GUN_ADLARI[v]) return v;
  const bulunan = Object.entries(EKSIK_GUN_ADLARI).find(([, ad]) => ad.toLocaleLowerCase("tr") === v.toLocaleLowerCase("tr"));
  return bulunan ? bulunan[0] : v;
}

export async function puantajOku(buffer: Buffer) {
  const kitap = new ExcelJS.Workbook();
  await kitap.xlsx.load(buffer as unknown as ArrayBuffer);
  const sayfa = kitap.worksheets[0];
  if (!sayfa) return [];
  const satirlar: { satir: number; personelNo: string; primGunu: number; eksikGunNedeni: string | null; fazlaMesaiBrut: number; primIkramiyeBrut: number; nakitYemekYardimi: number; fiiliCalismaGunu: number; sahisSigortaPrimi: number; hayatSigortaPrimi: number; sendikaAidati: number; aciklama: string | null }[] = [];
  sayfa.eachRow((r, n) => {
    if (n === 1) return;
    const no = metin(r.getCell(1).value);
    if (!no) return;
    satirlar.push({
      satir: n, personelNo: no, primGunu: sayi(r.getCell(4).value), eksikGunNedeni: eksikGunKodu(metin(r.getCell(5).value)),
      fazlaMesaiBrut: sayi(r.getCell(6).value), primIkramiyeBrut: sayi(r.getCell(7).value), nakitYemekYardimi: sayi(r.getCell(8).value),
      fiiliCalismaGunu: sayi(r.getCell(9).value), sahisSigortaPrimi: sayi(r.getCell(10).value), hayatSigortaPrimi: sayi(r.getCell(11).value),
      sendikaAidati: sayi(r.getCell(12).value), aciklama: metin(r.getCell(13).value) || null,
    });
  });
  return satirlar;
}
