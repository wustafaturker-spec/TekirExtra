/**
 * FTR-38/40: belgedeki "Yalnız …" satırı — tutarın belge dilinde yazıyla
 * karşılığı. Tam kısım ve kuruş ayrı ayrı yazılır; para birimi adı bilinen
 * dövizlerde dile göre, bilinmeyenlerde ISO koduyla basılır (kuruş "56/100").
 * Rusça ve Arapçada sayılan adın çekimi sayıya göre seçilir.
 */
import type { BelgeDili } from "@tekirextra/shared";

// ─── Türkçe ────────────────────────────────────────────────────────────────
const TR_BIR = ["", "BİR", "İKİ", "ÜÇ", "DÖRT", "BEŞ", "ALTI", "YEDİ", "SEKİZ", "DOKUZ"];
const TR_ON = ["", "ON", "YİRMİ", "OTUZ", "KIRK", "ELLİ", "ALTMIŞ", "YETMİŞ", "SEKSEN", "DOKSAN"];
function trUc(n: number): string[] {
  const y = Math.floor(n / 100), o = Math.floor((n % 100) / 10), b = n % 10;
  return [y ? (y > 1 ? `${TR_BIR[y]} YÜZ` : "YÜZ") : "", TR_ON[o], TR_BIR[b]].filter(Boolean);
}
function trSayi(n: number): string {
  if (n === 0) return "SIFIR";
  const parcalar: string[] = [];
  const basamaklar: [number, string][] = [[1e12, "TRİLYON"], [1e9, "MİLYAR"], [1e6, "MİLYON"], [1e3, "BİN"]];
  let kalan = n;
  for (const [deger, ad] of basamaklar) {
    const q = Math.floor(kalan / deger);
    if (!q) continue;
    // "Bir bin" denmez; "bin" yeter.
    if (!(deger === 1e3 && q === 1)) parcalar.push(...trUc(q));
    parcalar.push(ad);
    kalan %= deger;
  }
  parcalar.push(...trUc(kalan));
  return parcalar.join(" ");
}

// ─── İngilizce ─────────────────────────────────────────────────────────────
const EN_BIR = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
const EN_ON = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];
function enUc(n: number): string {
  const y = Math.floor(n / 100), r = n % 100;
  const iki = r < 20 ? EN_BIR[r] : EN_ON[Math.floor(r / 10)] + (r % 10 ? `-${EN_BIR[r % 10]}` : "");
  return [y ? `${EN_BIR[y]} HUNDRED` : "", iki].filter(Boolean).join(" ");
}
function enSayi(n: number): string {
  if (n === 0) return "ZERO";
  const parcalar: string[] = [];
  let kalan = n;
  for (const [deger, ad] of [[1e12, "TRILLION"], [1e9, "BILLION"], [1e6, "MILLION"], [1e3, "THOUSAND"]] as const) {
    const q = Math.floor(kalan / deger);
    if (q) { parcalar.push(`${enUc(q)} ${ad}`); kalan %= deger; }
  }
  if (kalan) parcalar.push(enUc(kalan));
  return parcalar.join(" ");
}

// ─── Almanca ───────────────────────────────────────────────────────────────
const DE_BIR = ["", "ein", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"];
const DE_ON = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"];
function deUc(n: number): string {
  const y = Math.floor(n / 100), r = n % 100;
  const iki = r < 20 ? DE_BIR[r] : (r % 10 ? `${DE_BIR[r % 10]}und` : "") + DE_ON[Math.floor(r / 10)];
  return (y ? `${DE_BIR[y]}hundert` : "") + iki;
}
function deSayi(n: number): string {
  if (n === 0) return "null";
  const parcalar: string[] = [];
  let kalan = n;
  for (const [deger, tekil, cogul] of [[1e12, "Billion", "Billionen"], [1e9, "Milliarde", "Milliarden"], [1e6, "Million", "Millionen"]] as const) {
    const q = Math.floor(kalan / deger);
    if (q) { parcalar.push(q === 1 ? `eine ${tekil}` : `${deUc(q)} ${cogul}`); kalan %= deger; }
  }
  let son = "";
  const bin = Math.floor(kalan / 1000);
  if (bin) son += `${deUc(bin)}tausend`;
  const r = kalan % 1000;
  // Tek başına 1 "eins" okunur; bileşikte "ein" kalır (einhundert, einundzwanzig).
  if (r) son += r % 100 === 1 ? `${deUc(r - 1)}eins` : deUc(r);
  if (son) parcalar.push(son);
  return parcalar.join(" ");
}

// ─── Rusça ─────────────────────────────────────────────────────────────────
const RU_BIR_E = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const RU_BIR_K = ["", "одна", "две", ...RU_BIR_E.slice(3)];
const RU_ON = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const RU_YUZ = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
/** Rusçada sayılan adın biçimi: 1 → [0], 2–4 → [1], diğerleri → [2]. */
export function ruBicim(n: number, bicimler: readonly [string, string, string]): string {
  const yuz = n % 100, on = n % 10;
  if (yuz >= 11 && yuz <= 19) return bicimler[2];
  if (on === 1) return bicimler[0];
  if (on >= 2 && on <= 4) return bicimler[1];
  return bicimler[2];
}
function ruUc(n: number, kadin: boolean): string[] {
  const y = Math.floor(n / 100), r = n % 100;
  const bir = kadin ? RU_BIR_K : RU_BIR_E;
  return [RU_YUZ[y], ...(r < 20 ? [bir[r]] : [RU_ON[Math.floor(r / 10)], bir[r % 10]])].filter(Boolean);
}
function ruSayi(n: number, kadin: boolean): string {
  if (n === 0) return "ноль";
  const parcalar: string[] = [];
  let kalan = n;
  const basamaklar: [number, readonly [string, string, string], boolean][] = [
    [1e12, ["триллион", "триллиона", "триллионов"], false],
    [1e9, ["миллиард", "миллиарда", "миллиардов"], false],
    [1e6, ["миллион", "миллиона", "миллионов"], false],
    [1e3, ["тысяча", "тысячи", "тысяч"], true],
  ];
  for (const [deger, ad, adKadin] of basamaklar) {
    const q = Math.floor(kalan / deger);
    if (q) { parcalar.push(...ruUc(q, adKadin), ruBicim(q, ad)); kalan %= deger; }
  }
  parcalar.push(...ruUc(kalan, kadin));
  return parcalar.join(" ");
}

// ─── Arapça ────────────────────────────────────────────────────────────────
// Ticari belgelerdeki yerleşik biçim: "فقط … لا غير". Sayılar eril sayılan
// (دولار) kalıbıyla yazılır; sayılan ad 1–2 tekil/ikil, 3–10 çoğul, 11–99
// tekil mansup, 100 ve katları tekil alır.
const AR_BIR = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const AR_ON = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const AR_YUZ = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
function arUc(n: number): string {
  const y = Math.floor(n / 100), r = n % 100;
  const iki = r < 20 ? AR_BIR[r] : (r % 10 ? `${AR_BIR[r % 10]} و${AR_ON[Math.floor(r / 10)]}` : AR_ON[Math.floor(r / 10)]);
  return [AR_YUZ[y], iki].filter(Boolean).join(" و");
}
/** Sayılan adın biçimi: [tekil, ikil, çoğul (3–10), mansup tekil (11–99)]. */
export function arBicim(n: number, b: readonly [string, string, string, string]): string {
  const r = n % 100;
  if (r === 1 && n < 100) return b[0];
  if (r === 2 && n < 100) return b[1];
  if (r >= 3 && r <= 10) return b[2];
  if (r >= 11) return b[3];
  return b[0];
}
const AR_BASAMAK: [number, readonly [string, string, string, string]][] = [
  [1e9, ["مليار", "ملياران", "مليارات", "ملياراً"]],
  [1e6, ["مليون", "مليونان", "ملايين", "مليوناً"]],
  [1e3, ["ألف", "ألفان", "آلاف", "ألفاً"]],
];
function arSayi(n: number): string {
  if (n === 0) return "صفر";
  const parcalar: string[] = [];
  let kalan = n;
  for (const [deger, ad] of AR_BASAMAK) {
    const q = Math.floor(kalan / deger);
    if (!q) continue;
    parcalar.push(q === 1 || q === 2 ? arBicim(q, ad) : `${arUc(q)} ${arBicim(q, ad)}`);
    kalan %= deger;
  }
  if (kalan) parcalar.push(arUc(kalan));
  return parcalar.join(" و");
}

// ─── Para birimi adları ────────────────────────────────────────────────────
type Ad = { tr: [string, string]; en: [string, string]; de: [string, string]; ru: [readonly [string, string, string], readonly [string, string, string]]; ar: [readonly [string, string, string, string], readonly [string, string, string, string]] };
const PARA_ADLARI: Record<string, Ad> = {
  TRY: {
    tr: ["TÜRK LİRASI", "KURUŞ"], en: ["TURKISH LIRA", "KURUS"], de: ["Türkische Lira", "Kuruş"],
    ru: [["турецкая лира", "турецкие лиры", "турецких лир"], ["куруш", "куруша", "курушей"]],
    ar: [["ليرة تركية", "ليرتان تركيتان", "ليرات تركية", "ليرة تركية"], ["قرش", "قرشان", "قروش", "قرشاً"]],
  },
  USD: {
    tr: ["ABD DOLARI", "SENT"], en: ["US DOLLARS", "CENTS"], de: ["US-Dollar", "Cent"],
    ru: [["доллар США", "доллара США", "долларов США"], ["цент", "цента", "центов"]],
    ar: [["دولار أمريكي", "دولاران أمريكيان", "دولارات أمريكية", "دولاراً أمريكياً"], ["سنت", "سنتان", "سنتات", "سنتاً"]],
  },
  EUR: {
    tr: ["AVRO", "SENT"], en: ["EUROS", "CENTS"], de: ["Euro", "Cent"],
    ru: [["евро", "евро", "евро"], ["евроцент", "евроцента", "евроцентов"]],
    ar: [["يورو", "يوروان", "يوروهات", "يورو"], ["سنت", "سنتان", "سنتات", "سنتاً"]],
  },
  GBP: {
    tr: ["İNGİLİZ STERLİNİ", "PENİ"], en: ["POUNDS STERLING", "PENCE"], de: ["Pfund Sterling", "Pence"],
    ru: [["фунт стерлингов", "фунта стерлингов", "фунтов стерлингов"], ["пенс", "пенса", "пенсов"]],
    ar: [["جنيه إسترليني", "جنيهان إسترلينيان", "جنيهات إسترلينية", "جنيهاً إسترلينياً"], ["بنس", "بنسان", "بنسات", "بنساً"]],
  },
};

/**
 * Tutarın belge dilinde yazıyla karşılığı ("Yalnız" etiketi hariç). Kuruş
 * iki haneye yuvarlanır; sıfırsa yazılmaz.
 */
export function yaziyla(tutar: number | string, dil: BelgeDili, doviz: string): string {
  const kurusluk = Math.round(Math.abs(Number(tutar)) * 100);
  const tam = Math.floor(kurusluk / 100), kurus = kurusluk % 100;
  const ad = PARA_ADLARI[doviz];
  const kod = doviz === "TRY" ? "TL" : doviz;
  const yuzde = `${String(kurus).padStart(2, "0")}/100`;
  switch (dil) {
    case "en":
      if (!ad) return `${enSayi(tam)} ${kod}${kurus ? ` AND ${yuzde}` : ""} ONLY`;
      return `${enSayi(tam)} ${ad.en[0]}${kurus ? ` AND ${enSayi(kurus)} ${ad.en[1]}` : ""} ONLY`;
    case "de":
      if (!ad) return `${deSayi(tam)} ${kod}${kurus ? ` ${yuzde}` : ""}`;
      return `${deSayi(tam)} ${ad.de[0]}${kurus ? ` und ${deSayi(kurus)} ${ad.de[1]}` : ""}`;
    case "ru": {
      // Lira dişil sayılır (одна лира, две лиры); diğerleri eril.
      const kadin = doviz === "TRY";
      if (!ad) return `${ruSayi(tam, false)} ${kod}${kurus ? ` ${yuzde}` : ""}`;
      return `${ruSayi(tam, kadin)} ${ruBicim(tam, ad.ru[0])}${kurus ? ` ${ruSayi(kurus, false)} ${ruBicim(kurus, ad.ru[1])}` : ""}`;
    }
    case "ar": {
      if (!ad) return `فقط ${arSayi(tam)} ${kod}${kurus ? ` و${yuzde}` : ""} لا غير`;
      // 1 ve 2'de sayı adın içinde söylenir (دولار أمريكي واحد → دولار أمريكي).
      const anaMetin = tam === 1 || tam === 2 ? arBicim(tam, ad.ar[0]) : `${arSayi(tam)} ${arBicim(tam, ad.ar[0])}`;
      const kurusMetin = !kurus ? "" : kurus <= 2 ? ` و${arBicim(kurus, ad.ar[1])}` : ` و${arSayi(kurus)} ${arBicim(kurus, ad.ar[1])}`;
      return `فقط ${anaMetin}${kurusMetin} لا غير`;
    }
    default:
      if (!ad) return `${trSayi(tam)} ${kod}${kurus ? ` ${yuzde}` : ""}`;
      return `${trSayi(tam)} ${ad.tr[0]}${kurus ? ` ${trSayi(kurus)} ${ad.tr[1]}` : ""}`;
  }
}
