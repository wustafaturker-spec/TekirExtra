/**
 * Arayüz biçimlendirmesinin tek doğruluk kaynağı.
 *
 * Ön muhasebede sayı, arayüzün kendisidir: aynı tutarın iki ekranda farklı
 * basamak, hizalama veya para birimi ile görünmesi kullanıcıda "yazılım
 * hesabı şaşırdı" izlenimi bırakır. Sayfa başına `toLocaleString` çağırmak
 * yerine bu modül kullanılır; `Intl` biçimlendiricileri pahalı olduğu için
 * örnekler önbelleğe alınır.
 */

export type SayisalDeger = string | number | null | undefined;

const SAYI_BICIMLERI = new Map<string, Intl.NumberFormat>();
const TARIH_BICIMLERI = new Map<string, Intl.DateTimeFormat>();

function sayiBicimlendirici(secenekler: Intl.NumberFormatOptions): Intl.NumberFormat {
  const anahtar = JSON.stringify(secenekler);
  let bicimlendirici = SAYI_BICIMLERI.get(anahtar);
  if (!bicimlendirici) {
    bicimlendirici = new Intl.NumberFormat("tr-TR", secenekler);
    SAYI_BICIMLERI.set(anahtar, bicimlendirici);
  }
  return bicimlendirici;
}

function tarihBicimlendirici(secenekler: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const anahtar = JSON.stringify(secenekler);
  let bicimlendirici = TARIH_BICIMLERI.get(anahtar);
  if (!bicimlendirici) {
    bicimlendirici = new Intl.DateTimeFormat("tr-TR", secenekler);
    TARIH_BICIMLERI.set(anahtar, bicimlendirici);
  }
  return bicimlendirici;
}

/** Prisma Decimal'ları string olarak taşındığı için giriş tipi geniş tutulur. */
export function sayiyaCevir(deger: SayisalDeger): number | null {
  if (deger === null || deger === undefined || deger === "") return null;
  const sayi = typeof deger === "number" ? deger : Number(deger);
  return Number.isFinite(sayi) ? sayi : null;
}

export interface ParaSecenekleri {
  /** ISO 4217 kodu; varsayılan TRY. */
  dovizCinsi?: string;
  /** Ondalık basamak; varsayılan 2. Özet kartlarında 0 tercih edilir. */
  basamak?: number;
  /** Para birimi simgesi gizlenir — kolon başlığında zaten yazıyorsa. */
  simgesiz?: boolean;
  /** null/boş değer için gösterilecek metin; varsayılan uzun tire. */
  bosDeger?: string;
}

/** Tutar: `1.234,50 ₺`. Tablo hücrelerinde <Para> bileşeni tercih edilir. */
export function paraBicimle(deger: SayisalDeger, secenekler: ParaSecenekleri = {}): string {
  const { dovizCinsi = "TRY", basamak = 2, simgesiz = false, bosDeger = "—" } = secenekler;
  const sayi = sayiyaCevir(deger);
  if (sayi === null) return bosDeger;
  return sayiBicimlendirici(
    simgesiz
      ? { minimumFractionDigits: basamak, maximumFractionDigits: basamak }
      : { style: "currency", currency: dovizCinsi, minimumFractionDigits: basamak, maximumFractionDigits: basamak },
  ).format(sayi);
}

/** Miktar: gereksiz sıfır basamak yazılmaz — `12` ve `12,5` birlikte okunur. */
export function miktarBicimle(deger: SayisalDeger, birim?: string | null, bosDeger = "—"): string {
  const sayi = sayiyaCevir(deger);
  if (sayi === null) return bosDeger;
  const metin = sayiBicimlendirici({ minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(sayi);
  return birim ? `${metin} ${birim}` : metin;
}

/** Yüzde: `%18` — Türkçe'de işaret sayının önünde yazılır. */
export function yuzdeBicimle(deger: SayisalDeger, basamak = 0, bosDeger = "—"): string {
  const sayi = sayiyaCevir(deger);
  if (sayi === null) return bosDeger;
  return `%${sayiBicimlendirici({ minimumFractionDigits: 0, maximumFractionDigits: basamak }).format(sayi)}`;
}

/**
 * Yalnız tarih taşıyan değerler (Prisma `@db.Date`) UTC gece yarısı olarak
 * gelir; yerel saatte biçimlenirse negatif ofsetli makinelerde bir gün geriye
 * kayar. Bu yüzden gün-ay-yıl değerleri UTC'de biçimlenir.
 */
function tarihMi(deger: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(deger) || /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(deger);
}

export type TarihGirdisi = string | number | Date | null | undefined;

function tariheCevir(deger: TarihGirdisi): { tarih: Date; saatSiz: boolean } | null {
  if (deger === null || deger === undefined || deger === "") return null;
  if (deger instanceof Date) return Number.isNaN(deger.getTime()) ? null : { tarih: deger, saatSiz: false };
  if (typeof deger === "number") return { tarih: new Date(deger), saatSiz: false };
  const tarih = new Date(deger);
  if (Number.isNaN(tarih.getTime())) return null;
  return { tarih, saatSiz: tarihMi(deger) };
}

/** Tarih: `15.08.2026`. */
export function tarihBicimle(deger: TarihGirdisi, bosDeger = "—"): string {
  const cozum = tariheCevir(deger);
  if (!cozum) return bosDeger;
  return tarihBicimlendirici({
    day: "2-digit", month: "2-digit", year: "numeric",
    ...(cozum.saatSiz ? { timeZone: "UTC" } : {}),
  }).format(cozum.tarih);
}

/** Tarih + saat: `15.08.2026 16:52`. Denetim izi ve olay kayıtları için. */
export function tarihSaatBicimle(deger: TarihGirdisi, bosDeger = "—"): string {
  const cozum = tariheCevir(deger);
  if (!cozum) return bosDeger;
  return tarihBicimlendirici({
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(cozum.tarih);
}

/** Ay adı: `Ağustos 2026` — dönem başlıklarında kullanılır. */
export function donemBicimle(yil: number, ay: number): string {
  return tarihBicimlendirici({ month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(yil, ay - 1, 1)));
}

/**
 * Arama karşılaştırması için metni sadeleştirir.
 *
 * `toLowerCase()` Türkçe'de "İ" harfini birleşik bir işaretle bozar ve "I"
 * harfini "ı" yerine "i" yapar; bu yüzden yerel duyarlı küçültme kullanılır.
 * Ardından aksanlar ayrıştırılıp atılır, böylece "sisli" araması "Şişli"yi de
 * bulur.
 *
 * Noktasız "ı" ayrı bir temel harftir; NFD onu ayrıştırmaz. Arama kutusuna
 * "cagri" yazan kullanıcı "Çağrı" kaydını da bulabilsin diye elle katlanır.
 */
export function metinNormalize(metin: string): string {
  return metin
    .toLocaleLowerCase("tr")
    .replace(/\u0131/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Normalize edilmiş alt dize eşleşmesi — arama kutularının ortak ölçütü. */
export function metinEslesiyor(icerik: string, aranan: string): boolean {
  return metinNormalize(icerik).includes(metinNormalize(aranan));
}
