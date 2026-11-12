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

// ─── CNL-21/22: ödeme hesabı ve araç planı ─────────────────────────────────

export interface FistenOkunan { plaka?: string | null; litre?: number | null; odemeSekli?: "nakit" | "kart" | "bilinmiyor" | null; kartSonDort?: string | null }
export interface HesapSecenegi { id: string; ad: string }
export interface TamamlamaPlani {
  odeme?: { tur: "kasa" | "kart"; hesapId: string; ad: string };
  arac?: { aracId: string; plaka: string; kategori: "akaryakit" | "otopark" | "hgs" | "diger"; litre?: number };
  notlar: string[];
  /** Belirsizlikte sorulacak hesaplar (CNL-09); seçenek kodu `h<i>`, ayrıca `sirket_degil`. */
  soru?: { tur: "kasa" | "kart"; hesaplar: HesapSecenegi[] };
}

const plakaSade = (p: string) => p.toLocaleUpperCase("tr-TR").replace(/[^A-Z0-9ÇĞİÖŞÜ]/g, "");

/**
 * CNL-21/22: fişten okunan plaka, litre ve ödeme bilgisi firmanın kayıtlarıyla eşleştirilir.
 * Yalnız tek eşleşme kesindir; kart/kasa belirsizse soru, plaka eşleşmezse not üretir.
 */
export function tamamlamaPlani(
  o: FistenOkunan,
  b: { cariBagli: boolean; dovizCinsi: string; kategoriAdi: string },
  kartlar: Array<{ id: string; ad: string; sonDortHane: string; dovizCinsi: string; aktif: boolean }>,
  kasalar: Array<{ id: string; ad: string; dovizCinsi: string; aktif: boolean }>,
  araclar: Array<{ id: string; plaka: string; aktif: boolean }>,
): TamamlamaPlani {
  const plan: TamamlamaPlani = { notlar: [] };
  if (o.plaka) {
    const p = plakaSade(o.plaka);
    const arac = araclar.find((a) => a.aktif && plakaSade(a.plaka) === p);
    const kat = sade(b.kategoriAdi);
    const kategori = o.litre || kat.includes("akaryak") ? "akaryakit" : kat.includes("otopark") ? "otopark" : kat.includes("hgs") || kat.includes("köprü") || kat.includes("otoyol") ? "hgs" : "diger";
    if (arac) plan.arac = { aracId: arac.id, plaka: arac.plaka, kategori, ...(kategori === "akaryakit" && o.litre ? { litre: Math.round(o.litre * 100) / 100 } : {}) };
    else plan.notlar.push(`Fişteki ${p} plakası araç kartlarında yok; araca bağlanmadı.`);
  }
  if (b.cariBagli) {
    plan.notlar.push("Satıcı cari olarak kayıtlı; ödeme cari tediyesinden yapılır.");
    return plan;
  }
  const uygunKart = kartlar.filter((k) => k.aktif && k.dovizCinsi === b.dovizCinsi);
  const uygunKasa = kasalar.filter((k) => k.aktif && k.dovizCinsi === b.dovizCinsi);
  if (o.odemeSekli === "kart") {
    const eslesen = o.kartSonDort ? uygunKart.filter((k) => k.sonDortHane === o.kartSonDort) : [];
    if (eslesen.length === 1) plan.odeme = { tur: "kart", hesapId: eslesen[0].id, ad: `${eslesen[0].ad} •••• ${eslesen[0].sonDortHane}` };
    else if (uygunKart.length) plan.soru = { tur: "kart", hesaplar: uygunKart.slice(0, 5).map((k) => ({ id: k.id, ad: `${k.ad} •••• ${k.sonDortHane}` })) };
    else plan.notlar.push(`Kartla ödenmiş${o.kartSonDort ? ` (•••• ${o.kartSonDort})` : ""} ama tanımlı şirket kartı yok; ödemeyi panelde seçin.`);
  } else if (o.odemeSekli === "nakit") {
    if (uygunKasa.length === 1) plan.odeme = { tur: "kasa", hesapId: uygunKasa[0].id, ad: uygunKasa[0].ad };
    else if (uygunKasa.length > 1) plan.soru = { tur: "kasa", hesaplar: uygunKasa.slice(0, 5).map((k) => ({ id: k.id, ad: k.ad })) };
    else plan.notlar.push("Nakit ödenmiş ama bu dövizde kasa yok; ödemeyi panelde seçin.");
  } else {
    plan.notlar.push("Ödeme şekli fişten okunamadı; ödemeyi panelde seçin.");
  }
  return plan;
}

export function odemeSorusu(t: MasrafTaslagi, s: NonNullable<TamamlamaPlani["soru"]>, kartSonDort: string | null | undefined): { soru: string; secenekler: Secenek[] } {
  const neden = s.tur === "kart"
    ? `Fiş kartla ödenmiş${kartSonDort ? ` (•••• ${kartSonDort})` : ""} ama hangi şirket kartı olduğunu kesin bulamadım.`
    : "Fiş nakit ödenmiş; birden çok kasa var.";
  return {
    soru: `${t.saticiUnvan ?? "Masraf"} — ${t.toplam.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t.dovizCinsi === "TRY" ? "TL" : t.dovizCinsi}: ${neden} Ödeme hangisinden yapıldı?`,
    secenekler: [
      ...s.hesaplar.map((h, i) => ({ kod: `h${i}`, etiket: h.ad.slice(0, 40) })),
      { kod: "sirket_degil", etiket: s.tur === "kart" ? "Şirket kartı değil" : "Kasadan değil" },
      PANEL_SECENEGI,
    ],
  };
}
