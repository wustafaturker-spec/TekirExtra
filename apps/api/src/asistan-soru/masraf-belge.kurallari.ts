import type { FisFaturaOcrSonuc } from "../ai/ai.semalar";
import { PANEL_SECENEGI, type Secenek } from "./asistan-soru.kurallari";

/**
 * CNL-16 kuralları (saf işlevler): OCR sonucundan masraf taslağı girdisi, kategori adı eşleşmesi ve
 * kategori sorusu. Tutar ve KDV yalnız OCR'dan gelir; okunamayan alan uydurulmaz, uyarı olur.
 */

/** OCR'a gidecek en büyük dosya (ai.semalar OCR_AZAMI_DOSYA_BAYT ile aynı). */
export const BELGE_AZAMI_BAYT = 6 * 1024 * 1024;

export interface MasrafTaslagi {
  belgeTuru: "fis" | "fatura" | "diger";
  tarih?: string;
  belgeNo?: string;
  saticiUnvan?: string;
  vknTckn?: string;
  cariId?: string;
  aciklama?: string;
  toplam: number;
  kdvOrani: number;
  dovizCinsi: string;
}

export function masrafTaslagi(ocr: FisFaturaOcrSonuc, eslesenCariId: string | null, not: string | null): { taslak: MasrafTaslagi; uyarilar: string[] } {
  const uyarilar: string[] = [];
  const oranlar = [...ocr.kdvKirilimi].sort((a, b) => b.matrah - a.matrah);
  if (oranlar.length > 1) uyarilar.push(`Belgede birden çok KDV oranı var (${oranlar.map((o) => `%${o.oran}`).join(", ")}); taslak en büyük matrahın oranıyla açıldı, panelde kontrol edin.`);
  const kdvOrani = oranlar[0]?.oran ?? (ocr.toplamMatrah > 0 ? Math.round((ocr.toplamKdv / ocr.toplamMatrah) * 100) : 0);
  if (!oranlar.length) uyarilar.push("KDV kırılımı okunamadı; oran toplamlardan hesaplandı.");
  if (!ocr.tarih) uyarilar.push("Belge tarihi okunamadı; bugünün tarihi kullanıldı.");
  if (ocr.guvenSkoru < 0.7) uyarilar.push("Okuma güveni düşük; tutarları belgeyle karşılaştırın.");
  const kalemler = ocr.kalemler.map((k) => k.aciklama.trim()).filter(Boolean).slice(0, 5).join(", ");
  const aciklama = [not?.trim(), kalemler].filter(Boolean).join(" — ").slice(0, 1000) || undefined;
  return {
    taslak: {
      belgeTuru: ocr.belgeTuru === "FIS" ? "fis" : ocr.belgeTuru === "BILINMIYOR" ? "diger" : "fatura",
      ...(ocr.tarih ? { tarih: ocr.tarih } : {}),
      ...(ocr.belgeNo ? { belgeNo: ocr.belgeNo.slice(0, 100) } : {}),
      saticiUnvan: ocr.saticiUnvan.slice(0, 255),
      ...(ocr.saticiVknTckn ? { vknTckn: ocr.saticiVknTckn } : {}),
      ...(eslesenCariId ? { cariId: eslesenCariId } : {}),
      ...(aciklama ? { aciklama } : {}),
      toplam: Math.round(ocr.genelToplam * 100) / 100,
      kdvOrani,
      dovizCinsi: (ocr.paraBirimi || "TRY").toUpperCase().slice(0, 3),
    },
    uyarilar,
  };
}

const sade = (m: string) => m.toLocaleLowerCase("tr-TR").replace(/[^a-zçğıöşü0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const BAGLACLAR = new Set(["ve", "ile", "veya", "ya", "da", "de", "gider", "giderleri", "gideri", "masraf", "masrafları"]);
const kelimeler = (m: string) => new Set(sade(m).split(" ").filter((k) => k.length >= 3 && !BAGLACLAR.has(k)));

/**
 * OCR'ın önerdiği kategori adı TEK bir kategoriyle eşleşirse o; birden çoğu ya da hiçbiri belirsizdir.
 * Kelime kümesiyle karşılaştırılır: "Akaryakıt / Ulaşım" ile "Akaryakıt ve Ulaşım" aynıdır; bir
 * tarafın bütün anlamlı kelimeleri öbüründe geçiyorsa eşleşme sayılır.
 */
export function kategoriAdlaBul(oneri: string | null | undefined, kategoriler: Array<{ id: string; ad: string }>): string | null {
  const o = kelimeler(oneri ?? "");
  if (!o.size) return null;
  const kapsar = (a: Set<string>, b: Set<string>) => [...b].every((k) => a.has(k));
  const uyan = kategoriler.filter((k) => { const a = kelimeler(k.ad); return a.size > 0 && (kapsar(a, o) || kapsar(o, a)); });
  return uyan.length === 1 ? uyan[0].id : null;
}

export function kategoriSorusu(t: MasrafTaslagi, kategoriler: Array<{ id: string; ad: string }>): { soru: string; secenekler: Secenek[] } {
  const tutar = `${t.toplam.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t.dovizCinsi === "TRY" ? "TL" : t.dovizCinsi}`;
  return {
    soru: `${t.saticiUnvan ?? "Satıcı okunamadı"} — ${tutar}${t.tarih ? `, ${t.tarih.split("-").reverse().join(".")}` : ""} belgesini masraf taslağı olarak açacağım. Hangi kategoriye yazayım?\nListede yoksa kategori adını yanıt olarak yazabilirsiniz.`,
    secenekler: [...kategoriler.slice(0, 5).map((k, i) => ({ kod: `kat${i}`, etiket: k.ad.slice(0, 40) })), PANEL_SECENEGI],
  };
}
