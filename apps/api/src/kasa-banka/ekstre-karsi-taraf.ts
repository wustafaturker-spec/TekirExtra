/**
 * KSB-17: banka ekstresi açıklamasından karşı tarafın adını çıkarıp cari
 * unvanlarıyla eşleştirir. Türk bankalarının ekstrelerinde karşı IBAN ve
 * unvan sütunu çoğu zaman boştur; karşı taraf yalnız açıklamada yazar ve
 * çoğu kez kısaltılmış ya da yarıda kesilmiştir:
 *   "Gönderen:BERUSA İŞ GÜVENLİĞİ TEKSTİL … SANAYİ TİCARET L" ↔ "BERUSA … SAN. TİC. LTD. ŞTİ."
 *   "GELEN HAVALE -EMKAMAK İNŞAAT HIRDAVAT -…"              ↔ "EMKA MAK.İNŞ.HIR.LTD.ŞTİ."
 *   "Gönderen: HÜSEYİN BOZKURT STARWAX OTOMOTİV"           ↔ "STARVAKS OTOMOTİV - HÜSEYİN BOZKURT"
 * Saf fonksiyonlar; veritabanı ve model kullanmaz.
 */
import { metniNormalle } from "./ekstre-oku";

/** Tüzel ek ve bağlaçlar: unvanı ayırt etmez, puana girmez. */
const GENEL = new Set([
  "ve", "san", "sanayi", "sanayii", "tic", "ticaret", "ltd", "limited", "sti", "sirketi", "sirket", "as", "a", "s", "anonim",
  "dis", "ic", "ith", "ihr", "ithalat", "ihracat", "paz", "pazarlama", "ltdsti", "tld", "co", "inc", "gmbh", "srl", "spa",
]);

/** Etiketli alanlar: değer bir sonraki virgüle, başka etikete ya da metnin sonuna kadardır. */
const ETIKET = "g[oö]nderen|g[oö]nderici|al[ıi]c[ıi]|alacakl[ıi]|ad[ıi] soyad[ıi]|kar[sş][ıi] taraf|talimatl[ıi]";
// Bazı bankalar etiketi önceki kelimeye yapıştırıyor ("…ÖDEMESİGönderen= ABDULLAH ELİM"); sınır aranmaz.
const ETIKETLI = new RegExp(`(${ETIKET})\\s*[:=]\\s*(.+?)(?=\\s*(?:,|;|\\)|\\s(?:${ETIKET})\\s*[:=]|$))`, "giu");
/** "GELEN EFT - FİRMA - …" / "GELEN HAVALE -FİRMA -…" biçimi (yalnız gelen; gidende ad gönderenin kendisidir). */
const GELEN_KALIBI = /\bgelen\s+(?:eft|havale|fast)\s*-\s*([^-]{3,}?)\s*(?:-|$)/iu;

export interface KarsiTarafAdayi {
  ad: string;
  /** Adın açıklamada nereden okunduğu; gerekçede gösterilir. */
  kaynak: string;
}

/**
 * Açıklamadan karşı taraf adayları, güvenilirlik sırasıyla. Girişte karşı taraf
 * gönderen, çıkışta alıcı/alacaklıdır. Gönderen ile alıcı aynı firmaysa (kendi
 * hesaplar arası virman) aday üretilmez.
 */
export function karsiTarafAdaylari(aciklama: string, karsiUnvan: string | null, giris: boolean, kendiAdlari: string[] = []): KarsiTarafAdayi[] {
  const kendimiz = (ad: string) => kendiAdlari.some((k) => adBenzerligi(ad, k) >= 0.6);
  return hamAdaylar(aciklama, karsiUnvan, giris).filter((a) => !kendimiz(a.ad));
}

/**
 * KSB-18: açıklama maaş ödemesi mi ("ŞUBAT 2026 MAAŞ ÖDEMESİ", "ücret ödemesi").
 * Tek başına "ücret" sayılmaz: "EFT ÜCRETİ" banka masrafıdır.
 */
export function maasOdemesiMi(aciklama: string): boolean {
  return /\b(maas|bordro)|\bucret\s+odeme/.test(metniNormalle(aciklama));
}

function etiketliAlanlar(aciklama: string) {
  return [...aciklama.matchAll(ETIKETLI)].map((m) => ({ etiket: metniNormalle(m[1]), deger: m[2].trim() })).filter((a) => a.deger.length >= 3);
}

/**
 * Firmanın kendi adı(ları): girişte alıcı, çıkışta gönderen hep firmanın kendisidir.
 * En az iki satırda tekrarlanan adlar alınır; kiracının unvanı ekstredeki yazımla
 * aynı olmayabilir (kısaltma, eski unvan).
 */
export function kendiAdlariniBul(satirlar: Array<{ aciklama: string; giris: boolean }>): string[] {
  const sayac = new Map<string, { ad: string; adet: number }>();
  for (const s of satirlar) {
    const alanlar = etiketliAlanlar(s.aciklama);
    const ad = alanlar.find((a) => a.etiket.startsWith(s.giris ? "alici" : "gonder"))?.deger;
    if (!ad) continue;
    const anahtar = ayirtEdici(ad).slice(0, 3).join(" ");
    if (!anahtar) continue;
    const kayit = sayac.get(anahtar) ?? { ad, adet: 0 };
    kayit.adet += 1;
    sayac.set(anahtar, kayit);
  }
  return [...sayac.values()].filter((k) => k.adet >= 2).map((k) => k.ad);
}

function hamAdaylar(aciklama: string, karsiUnvan: string | null, giris: boolean): KarsiTarafAdayi[] {
  const adaylar: KarsiTarafAdayi[] = [];
  if (karsiUnvan?.trim()) adaylar.push({ ad: karsiUnvan.trim(), kaynak: "karşı unvan" });
  const alanlar = etiketliAlanlar(aciklama);
  const gonderen = alanlar.find((a) => a.etiket.startsWith("gonder"));
  const alici = alanlar.find((a) => a.etiket.startsWith("alici"));
  if (gonderen && alici && adBenzerligi(gonderen.deger, alici.deger) >= 0.6) return adaylar;
  const sira = giris ? ["gonder", "karsi", "ad"] : ["alici", "alacakli", "talimatli", "karsi", "ad"];
  for (const onek of sira) {
    for (const a of alanlar.filter((x) => x.etiket.startsWith(onek))) adaylar.push({ ad: a.deger, kaynak: `“${a.etiket.split(" ")[0]}” alanı` });
  }
  if (giris) {
    const m = aciklama.match(GELEN_KALIBI);
    if (m) adaylar.push({ ad: m[1].trim(), kaynak: "gelen transfer satırı" });
  }
  return adaylar;
}

/** Türkçe ses denkliği: bankalar ve kartlar yabancı harfi farklı yazıyor ("STARWAX" ↔ "STARVAKS"). */
const sesli = (k: string) => k.replace(/w/g, "v").replace(/x/g, "ks").replace(/q/g, "k");
const kelimeler = (metin: string) => metniNormalle(metin).split(/[^a-z0-9]+/).filter((k) => k.length >= 2 && !/^\d+$/.test(k)).map(sesli);
const ayirtEdici = (metin: string) => kelimeler(metin).filter((k) => !GENEL.has(k));
/** Unvanın ayırt edici kelimeleri (tüzel ekler ve bağlaçlar atılmış, aksansız); CARI-56 da kullanır. */
export const adKelimeleri = ayirtEdici;

function mesafe1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, fark = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++fark > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return fark + (a.length - i) + (b.length - j) <= 1;
}

/** Kelime eşliği: aynı, kısaltma/kesik (en az 3 harf önek) ya da 5+ harfte tek harf farkı. */
export function kelimeUyar(a: string, b: string): boolean {
  if (a === b) return true;
  const [kisa, uzun] = a.length <= b.length ? [a, b] : [b, a];
  if (kisa.length >= 3 && uzun.startsWith(kisa)) return true;
  return kisa.length >= 5 && mesafe1(a, b);
}

/**
 * Bir unvanın kelimelerinden kaçının öteki adda karşılığı var. Bitişik yazım
 * ("emkamak" ↔ "emka" + "mak") için yan yana iki kelime birleşik de denenir.
 */
function eslesenler(kaynak: string[], hedef: string[]): Set<number> {
  const bulunan = new Set<number>();
  kaynak.forEach((k, i) => {
    if (hedef.some((h) => kelimeUyar(k, h))) bulunan.add(i);
    else if (i + 1 < kaynak.length && hedef.some((h) => h === k + kaynak[i + 1])) { bulunan.add(i); bulunan.add(i + 1); }
  });
  hedef.forEach((h, j) => {
    if (j + 1 < hedef.length) {
      const birlesik = h + hedef[j + 1];
      kaynak.forEach((k, i) => { if (k === birlesik) bulunan.add(i); });
    }
  });
  return bulunan;
}

/** Ağırlıksız iki yönlü benzerlik (0–1); gönderen ↔ alıcı aynılığı için. */
export function adBenzerligi(a: string, b: string): number {
  const x = ayirtEdici(a), y = ayirtEdici(b);
  if (!x.length || !y.length) return 0;
  const p = eslesenler(x, y).size / x.length, r = eslesenler(y, x).size / y.length;
  return p + r ? (2 * p * r) / (p + r) : 0;
}

export interface CariAdayi { id: string; kod: string; unvan: string }

export interface AdEslesmesi<C extends CariAdayi> {
  cari: C;
  /** 0–1 güven (ağırlıklı F ölçüsü). */
  puan: number;
  ad: string;
  kaynak: string;
  /** KSB-45: ad iki yönde eksiksiz eşleşti ya da puan AD_GUCLU üstünde. */
  guclu: boolean;
}

/** En iyi cari bu puanın altındaysa ya da ikinci bu farktan yakınsa öneri yapılmaz. */
export const AD_ESIGI = 0.55;
export const AD_FARKI = 0.15;
/** KSB-45: ad + tutar eşleşmesinin toplu onayda kesin sayılması için gereken ad gücü. */
export const AD_GUCLU = 0.85;

type Puanli<C> = { cari: C; puan: number; tam: boolean };

/**
 * Adayları cari unvanlarıyla puanlar. Ağırlık kelimenin unvanlar arasındaki
 * nadirliğidir (IDF): "BERUSA" belirleyici, "BOYA" değil. Adın bütün
 * ayırt edici kelimeleri (en az iki) carinin unvanında varsa — kişi adı
 * gönderen, unvan "FİRMA / KİŞİ ADI" — kapsam düşük olsa da kabul edilir.
 * Aday başına sıralı puan listesi döner (en güçlü kaynaklı aday önce).
 */
function adlariPuanla<C extends CariAdayi>(adaylar: KarsiTarafAdayi[], cariler: C[]): Array<{ aday: KarsiTarafAdayi; puanlar: Puanli<C>[] }> {
  if (!adaylar.length || !cariler.length) return [];
  const unvanKelimeleri = cariler.map((c) => [...new Set(ayirtEdici(c.unvan))]);
  const df = new Map<string, number>();
  for (const ks of unvanKelimeleri) for (const k of ks) df.set(k, (df.get(k) ?? 0) + 1);
  const agirlik = (k: string) => Math.log(1 + cariler.length / (df.get(k) ?? 0.5));

  return adaylar.flatMap((aday) => {
    const ad = [...new Set(ayirtEdici(aday.ad))];
    if (!ad.length) return [];
    const puanlar = cariler.map((cari, i) => {
      const u = unvanKelimeleri[i];
      if (!u.length) return { cari, puan: 0, tam: false };
      const adBulunan = eslesenler(ad, u), unvanBulunan = eslesenler(u, ad);
      const top = (ks: string[], set?: Set<number>) => ks.reduce((t, k, j) => t + (!set || set.has(j) ? agirlik(k) : 0), 0);
      const p = top(ad, adBulunan) / top(ad), r = top(u, unvanBulunan) / top(u);
      let puan = p + r ? (2 * p * r) / (p + r) : 0;
      if (adBulunan.size === ad.length && ad.length >= 2) puan = Math.max(puan, 0.6 + 0.4 * r);
      // İki yönde de eksiksiz eşleşme: aynı firmanın ek kodlu kopya kartının ("…-KRZ") önüne geçer.
      const tam = adBulunan.size === ad.length && unvanBulunan.size === u.length;
      return { cari, puan, tam };
    }).filter((x) => x.puan > 0).sort((a, b) => Number(b.tam) - Number(a.tam) || b.puan - a.puan);
    return [{ aday, puanlar }];
  });
}

const eslesme = <C extends CariAdayi>(x: Puanli<C>, aday: KarsiTarafAdayi): AdEslesmesi<C> =>
  ({ cari: x.cari, puan: Math.round(x.puan * 100) / 100, ad: aday.ad, kaynak: aday.kaynak, guclu: x.tam || x.puan >= AD_GUCLU });

export function cariyiAdlaBul<C extends CariAdayi>(adaylar: KarsiTarafAdayi[], cariler: C[]): AdEslesmesi<C> | null {
  for (const { aday, puanlar } of adlariPuanla(adaylar, cariler)) {
    const [ilk, ikinci] = puanlar;
    const ayrisiyor = !ikinci || ilk.puan - ikinci.puan >= AD_FARKI || (ilk.tam && !ikinci.tam);
    if (ilk && ilk.puan >= AD_ESIGI && ayrisiyor) return eslesme(ilk, aday);
    // Bu aday belirsiz kaldıysa sıradaki (daha zayıf kaynaklı) aday denenir.
  }
  return null;
}

/**
 * KSB-45: ad tek cariye ayrışmadığında eşiği geçen yakın adaylar (en çok 5);
 * tutar hangisinde tutuyorsa o seçilir. İlk eşiği geçen aday adı kullanılır.
 */
export function belirsizAdAdaylari<C extends CariAdayi>(adaylar: KarsiTarafAdayi[], cariler: C[]): AdEslesmesi<C>[] {
  for (const { aday, puanlar } of adlariPuanla(adaylar, cariler)) {
    const gecen = puanlar.filter((x) => x.puan >= AD_ESIGI);
    if (gecen.length < 2) continue;
    const ilk = gecen[0];
    return gecen.filter((x) => ilk.puan - x.puan < AD_FARKI).slice(0, 5).map((x) => eslesme(x, aday));
  }
  return [];
}
