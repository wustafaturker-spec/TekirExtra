/**
 * CARI-56…58: mükerrer cari şüphesi. Saf fonksiyonlar; veritabanı kullanmaz.
 *
 * Kenarlar (iki kart arasındaki şüphe) üç kaynaktan gelir: aynı VKN/TCKN,
 * unvan benzerliği (KSB-17 kelime eşliği) ve aynı IBAN. E-posta ve telefon
 * tek başına kenar açmaz (muhasebecinin ortak adresi gibi), yalnız gerekçeye
 * eklenir. Kenarlar birleşim-bul ile gruplanır; "aynı değil" işaretli çiftler
 * (CARI-57) kenar sayılmaz. Personel kartı birleştirmeye girmez: personel ile
 * başka kart arasındaki kenar "farklı rol" bilgisidir (CARI-58).
 */
import { MUHTELIF_MUSTERI_VKN, YURT_DISI_ALICI_VKN } from "@tekirextra/shared";
import { adKelimeleri } from "../kasa-banka/ekstre-karsi-taraf";
import { metniNormalle } from "../kasa-banka/ekstre-oku";

/** Birden çok gerçek kişi ya da firmanın paylaştığı GİB kimlikleri: mükerrer sayılmaz. */
export const ORTAK_KIMLIKLER = new Set(["11111111111", YURT_DISI_ALICI_VKN, MUHTELIF_MUSTERI_VKN]);

/** Unvan benzerliği bu eşikten itibaren şüphedir; aynı kimlikte bunun altı "farklı firma"dır. */
export const UNVAN_ESIGI = 0.8;
export const FARKLI_UNVAN_ESIGI = 0.5;
/** Bu kadar çok kartta geçen kelime aday çifti üretmez (karşılaştırma sayısını sınırlar). */
const YAYGIN_KELIME = 200;

export interface MukerrerKart {
  id: string;
  unvan: string;
  vknTckn: string | null;
  iban: string | null;
  eposta: string | null;
  telefon: string | null;
  /** tip personel ya da personel kaydı bağlı. */
  personel: boolean;
}

export type MukerrerTuru = "ayni_kimlik" | "kimlik_farkli_unvan" | "unvan" | "iban" | "farkli_rol";

export interface MukerrerGrubu {
  tur: MukerrerTuru;
  kartIdleri: string[];
  nedenler: string[];
  /** 0–1; sıralama için (aynı kimlik en üstte). */
  puan: number;
}

/** Unvanın karşılaştırılan kelimeleri; `kisaltma` sonunda nokta olanlardır ("MAK.", "HIRD."). */
export interface UnvanKelimeleri { kelimeler: string[]; kisaltma: Set<string> }

/** "…-KRZ" eki kopya kart işaretidir (karar 2026-10-23); karşılaştırmada yok sayılır. */
export function unvanKelimeleri(unvan: string): UnvanKelimeleri {
  const temiz = unvan.replace(/[\s-]*krz\s*$/i, "");
  const ses = (k: string) => k.replace(/w/g, "v").replace(/x/g, "ks").replace(/q/g, "k");
  return { kelimeler: adKelimeleri(temiz), kisaltma: new Set([...metniNormalle(temiz).matchAll(/([a-z]{2,})\./g)].map((m) => ses(m[1]))) };
}

/**
 * Kart unvanları için katı kelime eşliği. KSB-17'nin kesik ad ve tek harf
 * kuralı burada kullanılmaz ("DERİMSAN" ≠ "DERİVA", "RULMAN" ≠ "RULMAK"):
 * eşit, noktalı kısaltma ("MAK." ↔ "MAKİNA") ya da çoğul eki ("KARDEŞ" ↔ "KARDEŞLER").
 */
function kelimeEsit(a: string, b: string, ka: Set<string>, kb: Set<string>) {
  if (a === b) return true;
  const [kisa, uzun, kisaKisaltma] = a.length <= b.length ? [a, b, ka.has(a)] : [b, a, kb.has(b)];
  if (!uzun.startsWith(kisa)) return false;
  return kisaKisaltma || ["ler", "lar"].includes(uzun.slice(kisa.length));
}

function eslesenSayisi(x: UnvanKelimeleri, y: UnvanKelimeleri) {
  return x.kelimeler.filter((k) => y.kelimeler.some((h) => kelimeEsit(k, h, x.kisaltma, y.kisaltma))).length;
}

const kimlik = (k: MukerrerKart) => {
  const v = k.vknTckn?.replace(/\s/g, "");
  return v && /^\d{10,11}$/.test(v) && !ORTAK_KIMLIKLER.has(v) ? v : null;
};
const ibanNormal = (i: string | null) => i?.replace(/\s/g, "").toUpperCase() || null;
const telefonNormal = (t: string | null) => {
  const r = t?.replace(/\D/g, "").replace(/^(90|0)/, "") ?? "";
  return r.length >= 10 ? r : null;
};
const epostaNormal = (e: string | null) => e?.trim().toLowerCase() || null;

/**
 * İki kartın unvan benzerliği: iki yönlü F ölçüsü ya da kapsama — kısa unvanın
 * en az iki kelimesinin hepsi uzun unvanda geçer ("HÜSEYİN BOZKURT" ⊂ "STARVAKS OTOMOTİV - HÜSEYİN BOZKURT").
 */
export function unvanBenzerligi(x: UnvanKelimeleri, y: UnvanKelimeleri): number {
  if (!x.kelimeler.length || !y.kelimeler.length) return 0;
  const p = eslesenSayisi(x, y) / x.kelimeler.length, r = eslesenSayisi(y, x) / y.kelimeler.length;
  const f = p + r ? (2 * p * r) / (p + r) : 0;
  const [kisa, oran] = x.kelimeler.length <= y.kelimeler.length ? [x, p] : [y, r];
  return new Set(kisa.kelimeler).size >= 2 && oran === 1 ? Math.max(f, UNVAN_ESIGI) : f;
}

export const ciftAnahtari = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

interface Kenar { a: number; b: number; kimlik?: string; unvan?: number; iban?: boolean }

export function mukerrerGruplari(kartlar: MukerrerKart[], istisnalar: Set<string> = new Set()): MukerrerGrubu[] {
  const kelimeler = kartlar.map((k) => unvanKelimeleri(k.unvan));
  const kenarlar = new Map<string, Kenar>();
  const kenar = (a: number, b: number) => {
    if (a === b) return null;
    const anahtar = ciftAnahtari(kartlar[a].id, kartlar[b].id);
    if (istisnalar.has(anahtar)) return null;
    let k = kenarlar.get(anahtar);
    if (!k) kenarlar.set(anahtar, (k = { a: Math.min(a, b), b: Math.max(a, b) }));
    return k;
  };
  const kovala = (anahtarFn: (k: MukerrerKart) => string | null) => {
    const kova = new Map<string, number[]>();
    kartlar.forEach((k, i) => {
      const a = anahtarFn(k);
      if (a) kova.set(a, [...(kova.get(a) ?? []), i]);
    });
    return kova;
  };

  for (const [v, idx] of kovala(kimlik)) {
    for (let i = 0; i < idx.length; i++) for (let j = i + 1; j < idx.length; j++) {
      const k = kenar(idx[i], idx[j]);
      if (k) k.kimlik = v;
    }
  }
  for (const idx of kovala((k) => ibanNormal(k.iban)).values()) {
    for (let i = 0; i < idx.length; i++) for (let j = i + 1; j < idx.length; j++) {
      const k = kenar(idx[i], idx[j]);
      if (k) k.iban = true;
    }
  }
  // Unvan: yalnız en az bir ayırt edici kelimeyi paylaşan çiftler karşılaştırılır.
  const kelimeKovasi = new Map<string, number[]>();
  kelimeler.forEach((ks, i) => { for (const w of new Set(ks.kelimeler)) kelimeKovasi.set(w, [...(kelimeKovasi.get(w) ?? []), i]); });
  const bakildi = new Set<string>();
  for (const idx of kelimeKovasi.values()) {
    if (idx.length < 2 || idx.length > YAYGIN_KELIME) continue;
    for (let i = 0; i < idx.length; i++) for (let j = i + 1; j < idx.length; j++) {
      const anahtar = `${idx[i]}|${idx[j]}`;
      if (bakildi.has(anahtar)) continue;
      bakildi.add(anahtar);
      const puan = unvanBenzerligi(kelimeler[idx[i]], kelimeler[idx[j]]);
      if (puan < UNVAN_ESIGI) continue;
      const k = kenar(idx[i], idx[j]);
      if (k) k.unvan = puan;
    }
  }
  // Aynı kimlikte unvan puanı her zaman bilinsin ("farklı firma" ayrımı için).
  for (const k of kenarlar.values()) {
    if (k.kimlik && k.unvan === undefined) k.unvan = unvanBenzerligi(kelimeler[k.a], kelimeler[k.b]);
  }

  const gercek = [...kenarlar.values()].filter((k) => k.kimlik || k.iban || (k.unvan ?? 0) >= UNVAN_ESIGI);
  const gruplar: MukerrerGrubu[] = [];

  // Birleştirilebilir gruplar: personel kartı dışındaki kenarlar.
  const ata = kartlar.map((_, i) => i);
  const bul = (i: number): number => (ata[i] === i ? i : (ata[i] = bul(ata[i])));
  const birlesik = gercek.filter((k) => !kartlar[k.a].personel && !kartlar[k.b].personel);
  for (const k of birlesik) ata[bul(k.a)] = bul(k.b);
  const uyeler = new Map<number, number[]>();
  for (const k of birlesik) for (const i of [k.a, k.b]) {
    const kok = bul(i);
    const liste = uyeler.get(kok) ?? [];
    if (!liste.includes(i)) liste.push(i);
    uyeler.set(kok, liste);
  }
  for (const [kok, idx] of uyeler) {
    const ic = birlesik.filter((k) => bul(k.a) === kok);
    const kimlikli = ic.filter((k) => k.kimlik);
    const farkliUnvan = kimlikli.filter((k) => (k.unvan ?? 0) < FARKLI_UNVAN_ESIGI);
    const tur: MukerrerTuru = farkliUnvan.length ? "kimlik_farkli_unvan" : kimlikli.length ? "ayni_kimlik" : ic.some((k) => (k.unvan ?? 0) >= UNVAN_ESIGI) ? "unvan" : "iban";
    gruplar.push({ tur, kartIdleri: idx.map((i) => kartlar[i].id), nedenler: nedenler(ic, idx, kartlar), puan: grupPuani(tur, ic) });
  }

  // CARI-58: personel ↔ müşteri/tedarikçi aynı kişi — bilgi.
  const personelGruplari = new Map<number, Set<number>>();
  for (const k of gercek) {
    const [p, o] = kartlar[k.a].personel ? [k.a, k.b] : [k.b, k.a];
    if (!kartlar[p].personel || kartlar[o].personel) continue;
    personelGruplari.set(p, (personelGruplari.get(p) ?? new Set()).add(o));
  }
  for (const [p, digerleri] of personelGruplari) {
    const idx = [p, ...digerleri];
    const ic = gercek.filter((k) => idx.includes(k.a) && idx.includes(k.b));
    gruplar.push({ tur: "farkli_rol", kartIdleri: idx.map((i) => kartlar[i].id), nedenler: ["Aynı kişinin personel kartı ve başka rolde kartı; birleştirilmez.", ...nedenler(ic, idx, kartlar)], puan: 0 });
  }

  const sira: Record<MukerrerTuru, number> = { ayni_kimlik: 0, kimlik_farkli_unvan: 1, unvan: 2, iban: 3, farkli_rol: 4 };
  return gruplar.sort((x, y) => sira[x.tur] - sira[y.tur] || y.puan - x.puan || x.kartIdleri[0].localeCompare(y.kartIdleri[0]));
}

function grupPuani(tur: MukerrerTuru, ic: Kenar[]) {
  if (tur === "ayni_kimlik" || tur === "kimlik_farkli_unvan") return 1;
  return Math.max(...ic.map((k) => k.unvan ?? 0.6));
}

function nedenler(ic: Kenar[], idx: number[], kartlar: MukerrerKart[]): string[] {
  const sonuc: string[] = [];
  const kimlikler = [...new Set(ic.map((k) => k.kimlik).filter(Boolean))];
  for (const v of kimlikler) {
    const farkli = ic.some((k) => k.kimlik === v && (k.unvan ?? 0) < FARKLI_UNVAN_ESIGI);
    sonuc.push(farkli
      ? `Aynı ${v!.length === 11 ? "TCKN" : "VKN"} (${v}) ama unvanlar benzemiyor — VKN yanlış girilmiş olabilir, kartları kontrol edin.`
      : `Aynı ${v!.length === 11 ? "TCKN" : "VKN"}: ${v}`);
  }
  const enIyiUnvan = Math.max(0, ...ic.filter((k) => !k.kimlik).map((k) => k.unvan ?? 0));
  if (enIyiUnvan >= UNVAN_ESIGI) sonuc.push(`Unvan benzerliği %${Math.round(enIyiUnvan * 100)}`);
  if (ic.some((k) => k.iban)) sonuc.push("Aynı IBAN");
  const ortak = (fn: (k: MukerrerKart) => string | null) => {
    const degerler = idx.map((i) => fn(kartlar[i])).filter(Boolean);
    return new Set(degerler).size < degerler.length;
  };
  if (ortak((k) => epostaNormal(k.eposta))) sonuc.push("Aynı e-posta");
  if (ortak((k) => telefonNormal(k.telefon))) sonuc.push("Aynı telefon");
  return sonuc;
}
