import { metindekiSayilar } from "@tekirextra/shared";

/**
 * AI-111: finans kaynağı olmayan turda son yanıttaki para ve yüzde ifadeleri, bu turun araç
 * çıktılarında ya da kullanıcının mesajında (ve ekrandaki kayıtta) aranır. Bulunmayan ifade
 * bir kez düzeltme istemiyle, yine tutmazsa "[doğrulanamadı]" ile maskelenir.
 * Kapsam yalnız para ve yüzde; tarih, belge no, VKN ve miktar bilerek dışarıda (yanlış alarm).
 */

export interface RakamIfadesi {
  /** Yanıttaki ifadenin tamamı (birim ve çarpan dahil). */
  metin: string;
  baslangic: number;
  bitis: number;
  tur: "para" | "yuzde";
}

const SAYI = String.raw`-?\d{1,3}(?:[.  ]\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?`;
const CARPAN = String.raw`(?:\s*(?:bin|milyon|milyar)(?!\p{L}))?`;
const BIRIM = String.raw`(?:TL|TRY|USD|EUR|GBP|CHF|lira|dolar|avro|euro|₺|\$|€|£)(?!\p{L})`;
const ON_BIRIM = String.raw`(?:₺|\$|€|£)`;
const IFADE = new RegExp(
  [
    String.raw`(?<onbirim>${ON_BIRIM}\s*(?:${SAYI})${CARPAN})`,
    String.raw`(?<para>(?:${SAYI})${CARPAN}\s*${BIRIM})`,
    String.raw`(?<yuzde>(?:%|yüzde\s+)\s*(?:${SAYI})|(?:${SAYI})\s*%)`,
  ].join("|"),
  "giu",
);
const CARPANLAR: Record<string, number> = { bin: 1e3, milyon: 1e6, milyar: 1e9 };

/** Yanıttaki para ve yüzde ifadeleri. */
export function rakamIfadeleri(cevap: string): RakamIfadesi[] {
  const sonuc: RakamIfadesi[] = [];
  for (const m of cevap.matchAll(IFADE)) {
    const metin = m[0].trim();
    if (!/\d/.test(metin)) continue;
    const baslangic = m.index! + m[0].indexOf(metin);
    sonuc.push({ metin, baslangic, bitis: baslangic + metin.length, tur: m.groups?.yuzde ? "yuzde" : "para" });
  }
  return sonuc;
}

/** İfadenin olası değerleri ve gösterilen hassasiyetteki yuvarlama payı (Türkçe ve İngilizce okunuş). */
function adaylar(ifade: RakamIfadesi): Array<{ deger: number; pay: number }> {
  const ham = ifade.metin.match(new RegExp(SAYI, "u"))?.[0];
  if (!ham) return [];
  const carpan = CARPANLAR[(ifade.metin.match(/(bin|milyon|milyar)(?!\p{L})/iu)?.[1] ?? "").toLocaleLowerCase("tr")] ?? 1;
  const temiz = ham.replace(/[  ]/g, "");
  const okunuslar = new Set([temiz.replace(/\./g, "").replace(",", "."), temiz.replace(/,/g, "")]);
  return [...okunuslar].flatMap((o) => {
    const n = Number(o);
    if (!Number.isFinite(n)) return [];
    const ondalik = o.includes(".") ? o.split(".")[1].length : 0;
    return [{ deger: Math.abs(n) * carpan, pay: (10 ** -ondalik * carpan) / 2 + 1e-9 }];
  });
}

/** Kaynakta bulunmayan ifadeler. Yüzde, kaynakta oran (0,18) olarak da geçebilir. */
export function kaynaksizRakamlar(cevap: string, kaynakMetni: string): RakamIfadesi[] {
  const ifadeler = rakamIfadeleri(cevap);
  if (!ifadeler.length) return [];
  const kaynak = metindekiSayilar(kaynakMetni).map(Math.abs);
  return ifadeler.filter((ifade) => !adaylar(ifade).some(({ deger, pay }) =>
    kaynak.some((k) => Math.abs(k - deger) <= pay || (ifade.tur === "yuzde" && Math.abs(k * 100 - deger) <= pay)),
  ));
}

export const DOGRULANAMADI = "[doğrulanamadı]";
export const MASKE_UYARISI = "⚠️ Yanıttaki bazı tutarlar bu turdaki kaynak verilerde bulunamadığı için gizlendi; güncel değeri ilgili ekrandan ya da yeniden sorarak kontrol edin.";

/** Kaynaksız ifadeleri maskeler ve uyarıyı ekler. */
export function rakamlariMaskele(cevap: string, ifadeler: RakamIfadesi[]): string {
  let metin = cevap;
  for (const i of [...ifadeler].sort((a, b) => b.baslangic - a.baslangic)) metin = metin.slice(0, i.baslangic) + DOGRULANAMADI + metin.slice(i.bitis);
  return `${metin}\n\n${MASKE_UYARISI}`;
}

export const KAYNAKSIZ_RAKAM_ISTEMI = (ifadeler: RakamIfadesi[]) =>
  `[Sistem denetimi] Yanıtındaki şu tutar/oranlar bu turdaki araç sonuçlarında ve kullanıcının mesajında yok: ${[...new Set(ifadeler.map((i) => i.metin))].slice(0, 10).join("; ")}. ` +
  "Tutarı ve oranı yalnız araç sonuçlarından aynen aktar; gerekiyorsa ilgili aracı şimdi çağır. Toplam, fark, oran ya da tahmin hesaplama; önceki mesajlardaki tutarları doğrulanmış gibi tekrar etme. " +
  "Bu denetimden ve önceki yanıtından kullanıcıya söz etme; yalnız doğru yanıtı ver.";
