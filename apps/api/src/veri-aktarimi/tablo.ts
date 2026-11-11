import * as ExcelJS from "exceljs";
import { metinNormalize } from "@tekirextra/shared";

/**
 * VAK-03: başlığa göre okunan Excel tablosu. Şablon başlıkları ve kaynak programların
 * (Logo, Mikro, Netsis, Paraşüt) yaygın başlıkları eşanlamlı tanınır; tanınmayan başlık
 * kullanıcıya listelenir, elle bir alana eşlenebilir ya da yok sayılır.
 */
export interface SutunTanimi<A extends string = string> {
  anahtar: A;
  baslik: string;
  aciklama: string;
  ornek: string;
  /** Kaynak programların dışa aktarımlarındaki başlık yazımları. */
  esanlamlilar?: readonly string[];
}

export type TabloSatiri<A extends string = string> = { satir: number; hucreler: Partial<Record<A, string>> };

/** Normalleştirilmiş başlık → alan anahtarı; boş metin "yok say" demektir. */
export type BaslikEslemeleri = Record<string, string>;

export interface OkunanTablo<A extends string = string> {
  satirlar: TabloSatiri<A>[];
  /** Dosyadaki her başlık ve neye eşlendiği (önizlemede gösterilir). */
  basliklar: { baslik: string; anahtar: A | null; elle: boolean }[];
  /** Hiçbir alana eşlenmemiş ve yok sayılmamış başlıklar. */
  taninmayanlar: string[];
}

export const AZAMI_SATIR = 5000;

/** exceljs hücre değeri → metin (köprü, zengin metin, formül sonucu, tarih). */
export function hucreMetni(deger: ExcelJS.CellValue): string {
  if (deger === null || deger === undefined) return "";
  if (deger instanceof Date) return deger.toISOString().slice(0, 10);
  if (typeof deger === "object") {
    if ("richText" in deger) return deger.richText.map((p) => p.text).join("").trim();
    if ("text" in deger) return String(deger.text ?? "").trim();
    if ("result" in deger) return hucreMetni(deger.result as ExcelJS.CellValue);
    if ("error" in deger) return "";
  }
  return String(deger).trim();
}

export function baslikSozlugu<A extends string>(sutunlar: readonly SutunTanimi<A>[]): Map<string, A> {
  const sozluk = new Map<string, A>();
  for (const s of sutunlar) {
    for (const ad of [s.baslik, ...(s.esanlamlilar ?? [])]) {
      const n = metinNormalize(ad);
      if (!sozluk.has(n)) sozluk.set(n, s.anahtar);
    }
  }
  return sozluk;
}

export async function tabloOku<A extends string>(
  buffer: Buffer,
  sutunlar: readonly SutunTanimi<A>[],
  eslemeler: BaslikEslemeleri = {},
): Promise<OkunanTablo<A>> {
  const kitap = new ExcelJS.Workbook();
  try {
    await kitap.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new Error("Dosya okunamadı; Excel (.xlsx) dosyası yükleyin");
  }
  const sayfa = kitap.worksheets[0];
  if (!sayfa) throw new Error("Çalışma sayfası bulunamadı");
  const sozluk = baslikSozlugu(sutunlar);
  const gecerli = new Set<string>(sutunlar.map((s) => s.anahtar));
  const elle = new Map(Object.entries(eslemeler).map(([b, a]) => [metinNormalize(b), a]));
  const sutunAnahtari: Array<A | undefined> = [];
  const basliklar: OkunanTablo<A>["basliklar"] = [];
  const taninmayanlar: string[] = [];
  const kullanilan = new Set<string>();
  sayfa.getRow(1).eachCell({ includeEmpty: false }, (hucre, no) => {
    const baslik = hucreMetni(hucre.value);
    if (!baslik) return;
    const n = metinNormalize(baslik);
    let anahtar: A | undefined;
    let elleMi = false;
    if (elle.has(n)) {
      const a = elle.get(n)!;
      elleMi = true;
      if (a && gecerli.has(a)) anahtar = a as A;
    } else {
      anahtar = sozluk.get(n);
    }
    // Aynı alana iki sütun düşerse ilki kullanılır; ikincisi tanınmayan sayılır.
    if (anahtar && kullanilan.has(anahtar)) { anahtar = undefined; elleMi = false; }
    if (anahtar) kullanilan.add(anahtar);
    sutunAnahtari[no] = anahtar;
    basliklar.push({ baslik, anahtar: anahtar ?? null, elle: elleMi });
    if (!anahtar && !elleMi) taninmayanlar.push(baslik);
  });
  const satirlar: TabloSatiri<A>[] = [];
  sayfa.eachRow((row, no) => {
    if (no === 1) return;
    const hucreler: TabloSatiri<A>["hucreler"] = {};
    row.eachCell({ includeEmpty: false }, (hucre, s) => {
      const anahtar = sutunAnahtari[s];
      const metin = hucreMetni(hucre.value);
      if (anahtar && metin) hucreler[anahtar] = metin;
    });
    if (Object.keys(hucreler).length) satirlar.push({ satir: no, hucreler });
  });
  if (satirlar.length > AZAMI_SATIR) throw new Error(`Bir dosyada en fazla ${AZAMI_SATIR} satır aktarılabilir`);
  return { satirlar, basliklar, taninmayanlar };
}

/** Şablon: başlıklar ve örnek satır; sütun açıklamaları ve kurallar ikinci sayfada. */
export async function sablonYaz(sayfaAdi: string, sutunlar: readonly SutunTanimi[], kurallar: string[] = []): Promise<Buffer> {
  const kitap = new ExcelJS.Workbook();
  const sayfa = kitap.addWorksheet(sayfaAdi);
  sayfa.columns = sutunlar.map((s) => ({ header: s.baslik, key: s.anahtar, width: Math.max(12, s.baslik.length + 4) }));
  sayfa.getRow(1).font = { bold: true };
  sayfa.addRow(Object.fromEntries(sutunlar.map((s) => [s.anahtar, s.ornek])));
  sayfa.views = [{ state: "frozen", ySplit: 1 }];
  const aciklama = kitap.addWorksheet("Açıklama");
  aciklama.columns = [{ header: "Sütun", key: "baslik", width: 22 }, { header: "Açıklama", key: "aciklama", width: 100 }];
  aciklama.getRow(1).font = { bold: true };
  for (const s of sutunlar) aciklama.addRow({ baslik: s.baslik, aciklama: s.aciklama });
  if (kurallar.length) {
    aciklama.addRow({});
    for (const k of kurallar) aciklama.addRow({ baslik: "Kural", aciklama: k });
  }
  return Buffer.from(await kitap.xlsx.writeBuffer());
}

/** Hatalı satırlar: dosyadaki değerler ve en sağda hata nedeni; düzeltilip yeniden yüklenebilir. */
export async function hataliSatirlarYaz(sutunlar: readonly SutunTanimi[], satirlar: Array<TabloSatiri & { hatalar: string[] }>): Promise<Buffer> {
  const kitap = new ExcelJS.Workbook();
  const sayfa = kitap.addWorksheet("Hatalı satırlar");
  sayfa.columns = [
    ...sutunlar.map((s) => ({ header: s.baslik, key: s.anahtar, width: Math.max(12, s.baslik.length + 4) })),
    { header: "Satır", key: "_satir", width: 8 },
    { header: "Hata", key: "_hata", width: 80 },
  ];
  sayfa.getRow(1).font = { bold: true };
  for (const s of satirlar) sayfa.addRow({ ...s.hucreler, _satir: s.satir, _hata: s.hatalar.join("; ") });
  return Buffer.from(await kitap.xlsx.writeBuffer());
}
