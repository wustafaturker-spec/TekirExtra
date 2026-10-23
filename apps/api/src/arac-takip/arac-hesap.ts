/** ARC (§3.21): araç takibinin saf hesapları. Tutarlar TL, kuruşa yuvarlanır. */

const kurus = (n: number) => Math.round(n * 100) / 100;
const GUN_MS = 86_400_000;

export const GIDER_KATEGORILERI = ["akaryakit", "bakim", "lastik", "hgs", "otopark", "sigorta", "mtv", "ceza", "kira", "diger"] as const;
export type GiderKategorisi = (typeof GIDER_KATEGORILERI)[number];

export const YUKUMLULUK_TURLERI = ["muayene", "trafik_sigortasi", "kasko", "mtv", "egzoz", "takograf", "diger"] as const;
export type YukumlulukTuru = (typeof YUKUMLULUK_TURLERI)[number];

/** ARC-05: gider metninden kategori önerisi (kullanıcı değiştirebilir). */
export function kategoriOner(metin: string): GiderKategorisi {
  const m = metin.toLocaleLowerCase("tr");
  if (/akaryak|benzin|motorin|dizel|mazot|\blpg\b|opet|shell|petrol ofisi|\bpo\b|\bbp\b|total|aytemiz|yakıt/.test(m)) return "akaryakit";
  if (/\bhgs\b|\bogs\b|otoyol|köprü|kgm/.test(m)) return "hgs";
  if (/otopark|park ücreti|ispark/.test(m)) return "otopark";
  if (/lastik/.test(m)) return "lastik";
  if (/kasko|sigorta/.test(m)) return "sigorta";
  if (/motorlu taşıt|\bmtv\b/.test(m)) return "mtv";
  if (/ceza/.test(m)) return "ceza";
  if (/kira/.test(m)) return "kira";
  if (/bakım|servis|onarım|tamir|yağ değişim|yedek parça|muayene/.test(m)) return "bakim";
  return "diger";
}

/** Plaka karşılaştırması: boşluk ve büyük/küçük harf yok sayılır ("34 ABC 123" = "34abc123"). */
export const plakaNormal = (p: string) => p.replace(/\s+/g, "").toLocaleUpperCase("tr");
export const plakaGeciyor = (metin: string, plaka: string) => plakaNormal(metin).includes(plakaNormal(plaka));

export interface GiderSatiri { kategori: GiderKategorisi; tarih: string; tutarTry: number }

export interface KkegSonucu {
  kiraDisiGider: number;
  kiraDisiKkeg: number;
  kiraKkeg: number;
  aylar: Array<{ ay: string; kira: number; sinir: number | null; kkeg: number }>;
  /** Kira sınırı kaydı bulunmayan yıllar (o aylarda KKEG hesaplanmadı). */
  sinirEksikYillar: number[];
  toplamKkeg: number;
}

/**
 * ARC-06 (GVK 40/5): binek otoda kira dışı giderlerin (100 − oran)%'i KKEG;
 * kira bedelinin her ay sınırı aşan kısmı KKEG. Oran yoksa kira dışı KKEG
 * hesaplanmaz; yılın kira sınırı yoksa o yılın ayları bildirilir.
 */
export function binekKkeg(giderler: GiderSatiri[], oran: number | null, kiraSiniri: (yil: number) => number | null): KkegSonucu {
  const kiraDisi = giderler.filter((g) => g.kategori !== "kira");
  const kiraDisiGider = kurus(kiraDisi.reduce((t, g) => t + g.tutarTry, 0));
  const kiraDisiKkeg = oran == null ? 0 : kurus((kiraDisiGider * (100 - oran)) / 100);
  const aylik = new Map<string, number>();
  for (const g of giderler.filter((x) => x.kategori === "kira")) aylik.set(g.tarih.slice(0, 7), (aylik.get(g.tarih.slice(0, 7)) ?? 0) + g.tutarTry);
  const sinirEksik = new Set<number>();
  const aylar = [...aylik.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ay, kira]) => {
    const sinir = kiraSiniri(Number(ay.slice(0, 4)));
    if (sinir == null) sinirEksik.add(Number(ay.slice(0, 4)));
    return { ay, kira: kurus(kira), sinir, kkeg: sinir == null ? 0 : kurus(Math.max(0, kira - sinir)) };
  });
  const kiraKkeg = kurus(aylar.reduce((t, a) => t + a.kkeg, 0));
  return { kiraDisiGider, kiraDisiKkeg, kiraKkeg, aylar, sinirEksikYillar: [...sinirEksik].sort(), toplamKkeg: kurus(kiraDisiKkeg + kiraKkeg) };
}

/**
 * ARC-08: 100 km başına tüketim. Km'si girilmiş akaryakıt alımları km'ye göre
 * dizilir; ilk alımın litresi önceki yolu karşıladığı için sayılmaz.
 */
export function tuketim(alimlar: Array<{ km: number | null; litre: number | null }>): number | null {
  const s = alimlar.filter((a): a is { km: number; litre: number } => a.km != null && a.litre != null && a.litre > 0).sort((a, b) => a.km - b.km);
  if (s.length < 2) return null;
  const yol = s[s.length - 1].km - s[0].km;
  if (yol <= 0) return null;
  const litre = s.slice(1).reduce((t, a) => t + a.litre, 0);
  return Math.round((litre / yol) * 100 * 100) / 100;
}

export interface BakimDurumu { tarih: string | null; km: number | null; kalanGun: number | null; kalanKm: number | null; gecikti: boolean; yaklasiyor: boolean }

const ayEkle = (tarih: string, ay: number) => {
  const d = new Date(`${tarih}T00:00:00Z`);
  const hedef = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + ay, 1));
  const sonGun = new Date(Date.UTC(hedef.getUTCFullYear(), hedef.getUTCMonth() + 1, 0)).getUTCDate();
  hedef.setUTCDate(Math.min(d.getUTCDate(), sonGun));
  return hedef.toISOString().slice(0, 10);
};

/**
 * ARC-07: sıradaki bakım — km ve/veya ay aralığına göre; hangisi önce gelirse.
 * Son bakım yoksa plan başlamamıştır (null). 30 gün ya da 1.000 km kala yaklaşır.
 */
export function sonrakiBakim(p: { kmAraligi: number | null; ayAraligi: number | null; sonTarih: string | null; sonKm: number | null; guncelKm: number | null; bugun: string }): BakimDurumu | null {
  if (!p.kmAraligi && !p.ayAraligi) return null;
  if (!p.sonTarih && p.sonKm == null) return null;
  const tarih = p.ayAraligi && p.sonTarih ? ayEkle(p.sonTarih, p.ayAraligi) : null;
  const km = p.kmAraligi && p.sonKm != null ? p.sonKm + p.kmAraligi : null;
  const kalanGun = tarih ? Math.round((Date.parse(tarih) - Date.parse(p.bugun)) / GUN_MS) : null;
  const kalanKm = km != null && p.guncelKm != null ? km - p.guncelKm : null;
  const gecikti = (kalanGun != null && kalanGun < 0) || (kalanKm != null && kalanKm < 0);
  const yaklasiyor = !gecikti && ((kalanGun != null && kalanGun <= 30) || (kalanKm != null && kalanKm <= 1000));
  return { tarih, km, kalanGun, kalanKm, gecikti, yaklasiyor };
}

/** ARC-04: geçerli yükümlülüğün durumu — 30 ve 7 gün eşikleri, geçince "doldu". */
export function yukumlulukDurumu(bitis: string, bugun: string): { kalanGun: number; esik: "doldu" | "7" | "30" | null } {
  const kalanGun = Math.round((Date.parse(bitis) - Date.parse(bugun)) / GUN_MS);
  return { kalanGun, esik: kalanGun < 0 ? "doldu" : kalanGun <= 7 ? "7" : kalanGun <= 30 ? "30" : null };
}

/** Her türün en son girilen (bitişi en ileri) kaydı geçerlidir. */
export function gecerliYukumlulukler<T extends { tur: string; bitis: string }>(kayitlar: T[]): T[] {
  const enSon = new Map<string, T>();
  for (const k of kayitlar) {
    const o = enSon.get(k.tur);
    if (!o || k.bitis > o.bitis) enSon.set(k.tur, k);
  }
  return [...enSon.values()].sort((a, b) => a.bitis.localeCompare(b.bitis));
}
