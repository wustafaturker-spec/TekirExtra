/**
 * Birim adından UBL birim koduna eşleme (UN/ECE Rec 20 — GİB'in beklediği küme).
 *
 * Birim, stok kartında ve fatura satırında serbest metindir ("adet", "kg");
 * UBL ise `unitCode` bekler. Eşleme olmadığı için giden belgelerde kod sabit
 * yazılıyordu — kilogramla satılan mal da "adet" görünüyordu. Kural tek yerde
 * durur, faturayı da irsaliyeyi de bu işlev besler.
 */

/** Eşleşmeyen birimde kullanılan kod: adet. */
export const VARSAYILAN_BIRIM_KODU = "C62";

/**
 * Anahtarlar sadeleştirilmiş birim adıdır (küçük harf, noktalama ve boşluk
 * atılmış). Bir koda birden çok yazım bağlanabilir.
 */
const KODLAR: Record<string, string> = {
  // Sayılabilir
  adet: "C62", ad: "C62", tane: "C62", parca: "C62", pcs: "C62", unit: "C62",
  cift: "PR", duzine: "DZN", takim: "SET", set: "SET",
  paket: "PK", kutu: "BX", koli: "CT", rulo: "RO", cuval: "BG", torba: "BG",
  palet: "PF", varil: "BBL", sise: "BO", bidon: "CY", top: "RO", demet: "BE",
  // Ağırlık
  kg: "KGM", kilogram: "KGM", kilo: "KGM",
  g: "GRM", gr: "GRM", gram: "GRM",
  mg: "MGM", miligram: "MGM",
  ton: "TNE", tonne: "TNE",
  // Hacim
  lt: "LTR", l: "LTR", litre: "LTR", liter: "LTR",
  ml: "MLT", mililitre: "MLT",
  m3: "MTQ", metrekup: "MTQ", metrekup3: "MTQ",
  // Uzunluk ve alan
  m: "MTR", metre: "MTR", mt: "MTR",
  cm: "CMT", santimetre: "CMT",
  mm: "MMT", milimetre: "MMT",
  km: "KMT", kilometre: "KMT",
  m2: "MTK", metrekare: "MTK",
  // Zaman
  saat: "HUR", sa: "HUR", hour: "HUR",
  dakika: "MIN", gun: "DAY", hafta: "WEE", ay: "MON", yil: "ANN",
  // Enerji
  kwh: "KWH", kilowattsaat: "KWH", kw: "KWT", mwh: "MWH",
};

/** "Kg.", "M²", "ADET" gibi yazımları aynı anahtara indirger. */
function sadelestir(birim: string): string {
  return birim
    .toLocaleLowerCase("tr-TR")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/[\s._/-]/g, "")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

/** Birim adının UBL karşılığı; tanınmayan birim adet sayılır. */
export function birimUblKodu(birim: string | null | undefined): string {
  if (!birim) return VARSAYILAN_BIRIM_KODU;
  return KODLAR[sadelestir(birim)] ?? VARSAYILAN_BIRIM_KODU;
}

/** Birimin eşlemesi var mı; ekranlar "adet sayılacak" uyarısı için kullanır. */
export function birimTanindiMi(birim: string | null | undefined): boolean {
  return Boolean(birim) && sadelestir(birim!) in KODLAR;
}

/**
 * Stok kartında ve belge satırında seçilebilen birimler (STK-01/STK-10).
 * `ad` saklanan değerdir; gelen e-faturanın birim adlarıyla (ubl-oku) aynıdır.
 * Hepsinin GİB kodu vardır, böylece giden belgeye yanlışlıkla adet gitmez.
 */
export const BIRIMLER: readonly { ad: string; etiket: string }[] = [
  { ad: "adet", etiket: "Adet" },
  { ad: "kg", etiket: "Kilogram (kg)" },
  { ad: "gram", etiket: "Gram (g)" },
  { ad: "mg", etiket: "Miligram (mg)" },
  { ad: "ton", etiket: "Ton" },
  { ad: "litre", etiket: "Litre (lt)" },
  { ad: "ml", etiket: "Mililitre (ml)" },
  { ad: "metre", etiket: "Metre (m)" },
  { ad: "cm", etiket: "Santimetre (cm)" },
  { ad: "mm", etiket: "Milimetre (mm)" },
  { ad: "km", etiket: "Kilometre (km)" },
  { ad: "m2", etiket: "Metrekare (m²)" },
  { ad: "m3", etiket: "Metreküp (m³)" },
  { ad: "paket", etiket: "Paket" },
  { ad: "kutu", etiket: "Kutu" },
  { ad: "koli", etiket: "Koli" },
  { ad: "çift", etiket: "Çift" },
  { ad: "set", etiket: "Set / Takım" },
  { ad: "düzine", etiket: "Düzine" },
  { ad: "rulo", etiket: "Rulo" },
  { ad: "çuval", etiket: "Çuval" },
  { ad: "palet", etiket: "Palet" },
  { ad: "şişe", etiket: "Şişe" },
  { ad: "varil", etiket: "Varil" },
  { ad: "saat", etiket: "Saat" },
  { ad: "gün", etiket: "Gün" },
  { ad: "ay", etiket: "Ay" },
  { ad: "yıl", etiket: "Yıl" },
  { ad: "kwh", etiket: "Kilovatsaat (kWh)" },
];

/**
 * Serbest yazılmış birimi listedeki ada çevirir ("Kg." → "kg", "lt" → "litre",
 * "tane" → "adet"); karşılığı yoksa null. Excel içe aktarma ve API girdisi
 * bununla sadeleşir.
 */
export function birimCoz(birim: string | null | undefined): string | null {
  if (!birim) return null;
  const kod = KODLAR[sadelestir(birim)];
  if (!kod) return null;
  return BIRIMLER.find((b) => KODLAR[sadelestir(b.ad)] === kod)?.ad ?? null;
}

/** Ekranda gösterilecek kısa ad; listede yoksa olduğu gibi döner. */
export function birimEtiketi(birim: string | null | undefined): string {
  if (!birim) return "";
  return BIRIMLER.find((b) => b.ad === birim)?.etiket ?? birim;
}

/** Dar alanlar (belge satırı, stok miktarı) için kısa yazım: "m2" → "m²". */
export function birimKisaAdi(birim: string | null | undefined): string {
  if (!birim) return "";
  return birim.replace(/^m2$/, "m²").replace(/^m3$/, "m³").replace(/^kwh$/, "kWh");
}

/**
 * Aynı ölçü ailesindeki birimlerin ortak tabana oranı (kütle kg, hacim litre,
 * uzunluk metre). Reçetede kartta ek birim tanımlamadan kg malzemeyi g/mg,
 * litreyi ml ile girmek için.
 */
const OLCU_AILELERI: readonly Record<string, string>[] = [
  { ton: "1000", kg: "1", gram: "0.001", mg: "0.000001" },
  { m3: "1000", litre: "1", ml: "0.001" },
  { km: "1000", metre: "1", cm: "0.01", mm: "0.001" },
];

/** Ana birimle aynı ölçü ailesindeki birimler (ana birim dahil); aile yoksa yalnız ana birim. */
export function olcuAilesi(anaBirim: string): string[] {
  const aile = OLCU_AILELERI.find((a) => anaBirim in a);
  return aile ? Object.keys(aile) : [anaBirim];
}

/**
 * `birim`in 1'i kaç `anaBirim` eder; aynı aileden değilse null. Ondalık metin
 * döner (ör. kg kartında mg → "0.000001"), hesap çağıranda kayıpsız yapılır.
 */
export function olcuKatsayisi(anaBirim: string, birim: string): string | null {
  if (anaBirim === birim) return "1";
  const aile = OLCU_AILELERI.find((a) => anaBirim in a && birim in a);
  if (!aile) return null;
  const [ana, hedef] = [Number(aile[anaBirim]), Number(aile[birim])];
  // Oranlar 10'un kuvvetleri: kayan nokta artığı olmadan yazılır.
  const oran = hedef / ana;
  return oran >= 1 ? String(Math.round(oran)) : `0.${"0".repeat(Math.round(-Math.log10(oran)) - 1)}1`;
}
