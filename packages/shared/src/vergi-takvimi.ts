import { resmiTatiller } from "./resmi-tatiller";
import type { TakvimSatiri } from "./donemsel-degerler";

/**
 * VTK: Vergi ve SGK takvimi. Son tarihler kodla hesaplanmaz; platform sistem
 * yöneticisi Mevzuat Merkezi'nde kesin tarih olarak yayınlar. Buradaki öneri
 * yalnız yöneticinin taslağını doldurur, yayınlanan tarih değildir.
 */

export const VERGI_TAKVIMI_TURU = "vergi_takvimi";

export const VERGI_YUKUMLULUKLERI = ["kdv1", "kdv2", "muhtasar", "sgk", "muhtasar3"] as const;
export type VergiYukumlulugu = (typeof VERGI_YUKUMLULUKLERI)[number];

export const VERGI_YUKUMLULUK_ADLARI: Record<VergiYukumlulugu, string> = {
  kdv1: "KDV-1",
  kdv2: "KDV-2",
  muhtasar: "Muhtasar",
  sgk: "SGK primi",
  muhtasar3: "Muhtasar (üç aylık)",
};

export const VERGI_TAKVIM_ANAHTAR_DESENI = /^(kdv1|kdv2|muhtasar|sgk|muhtasar3):\d{4}-(0[1-9]|1[0-2])$/;

export const vergiYukumlulukMu = (d: string): d is VergiYukumlulugu => (VERGI_YUKUMLULUKLERI as readonly string[]).includes(d);

const iki = (n: number) => String(n).padStart(2, "0");

export const vergiTakvimAnahtari = (y: VergiYukumlulugu, yil: number, ay: number) => `${y}:${yil}-${iki(ay)}`;

export function vergiTakvimAnahtariCoz(anahtar: string): { yukumluluk: VergiYukumlulugu; yil: number; ay: number } | null {
  if (!VERGI_TAKVIM_ANAHTAR_DESENI.test(anahtar)) return null;
  const [y, donem] = anahtar.split(":") as [VergiYukumlulugu, string];
  return { yukumluluk: y, yil: Number(donem.slice(0, 4)), ay: Number(donem.slice(5, 7)) };
}

/** Yükümlülüğün yıl içindeki dönemleri; üç aylık muhtasarda dönem son ayıyla anılır. */
export const vergiDonemAylari = (y: VergiYukumlulugu): number[] => (y === "muhtasar3" ? [3, 6, 9, 12] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

export const donemSonGunu = (yil: number, ay: number) => new Date(Date.UTC(yil, ay, 0)).toISOString().slice(0, 10);

export function gecerliTarihMi(tarih: unknown): tarih is string {
  if (typeof tarih !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(tarih)) return false;
  const t = new Date(`${tarih}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === tarih;
}

/** Son tarih dönem bitmeden olamaz; yazım hatalarını yakalamak için bir yıl sınırı konur. */
export function vergiSonTarihHatasi(yil: number, ay: number, tarih: unknown): string | null {
  if (!gecerliTarihMi(tarih)) return "Son tarih geçerli bir tarih olmalıdır (YYYY-AA-GG)";
  const son = donemSonGunu(yil, ay);
  if (tarih <= son) return `Son tarih dönem bittikten sonra olmalıdır (dönem sonu ${son})`;
  if (tarih > donemSonGunu(yil + 1, ay)) return "Son tarih dönem sonundan bir yıldan uzak olamaz";
  return null;
}

const tatilAdi = (tarih: string): { ad: string; yarimGun: boolean } | null => resmiTatiller(Number(tarih.slice(0, 4))).find((t) => t.tarih === tarih) ?? null;
const haftaGunu = (tarih: string) => new Date(`${tarih}T00:00:00Z`).getUTCDay();
const gunIleri = (tarih: string) => new Date(Date.parse(`${tarih}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Hafta sonu ve tam gün tatili atlar. Arife (yarım gün) iş günü sayılır; kesin karar yöneticinindir. */
export function isGununeKaydir(tarih: string): string {
  let t = tarih;
  while (haftaGunu(t) === 0 || haftaGunu(t) === 6 || tatilAdi(t)?.yarimGun === false) t = gunIleri(t);
  return t;
}

/** Önizleme uyarısı: uzatma olabileceği için engel değildir. */
export function vergiTarihUyarisi(tarih: string): string | null {
  const gun = haftaGunu(tarih);
  if (gun === 0 || gun === 6) return "Hafta sonuna denk geliyor";
  const tatil = tatilAdi(tarih);
  return tatil ? `${tatil.ad} gününe denk geliyor` : null;
}

export type VergiGunDegeri = number | "ay_sonu";
export type VergiGunleri = Partial<Record<VergiYukumlulugu, VergiGunDegeri>>;
export interface VergiTakvimSatiri { yukumluluk: VergiYukumlulugu; ay: number; sonTarih: string }

/** Dönemden kaç ay sonra öderiz: üç aylık muhtasar dönemi izleyen ikinci ayda, diğerleri izleyen ayda. */
const odemeAyFarki = (y: VergiYukumlulugu) => (y === "muhtasar3" ? 2 : 1);

function oneriTarihi(y: VergiYukumlulugu, yil: number, ay: number, gun: VergiGunDegeri): string {
  const hedef = new Date(Date.UTC(yil, ay - 1 + odemeAyFarki(y), 1));
  const hedefYil = hedef.getUTCFullYear(), hedefAy = hedef.getUTCMonth() + 1;
  const sonGun = new Date(Date.UTC(hedefYil, hedefAy, 0)).getUTCDate();
  return isGununeKaydir(`${hedefYil}-${iki(hedefAy)}-${iki(gun === "ay_sonu" ? sonGun : Math.min(gun, sonGun))}`);
}

/** VTK-06: günlerden 12 ayın önerisi; yalnız girilen yükümlülükler için satır üretir. */
export function vergiTakvimOnerisi(yil: number, gunler: VergiGunleri): VergiTakvimSatiri[] {
  return VERGI_YUKUMLULUKLERI.flatMap((y) => {
    const gun = gunler[y];
    return gun === undefined ? [] : vergiDonemAylari(y).map((ay) => ({ yukumluluk: y, ay, sonTarih: oneriTarihi(y, yil, ay, gun) }));
  });
}

/**
 * VTK-14: önceki yılın yayınlanmış tarihlerinden gün değerlerini çıkarır. Hafta
 * sonundan kaymış tarihler günü bozmasın diye en sık görülen gün alınır; ayın son
 * günü ya da ondan kaymış tarih çoğunluktaysa değer "ay sonu"dur.
 */
export function vergiGunleriniCikar(satirlar: readonly VergiTakvimSatiri[], yil: number): VergiGunleri {
  const sonuc: VergiGunleri = {};
  for (const y of VERGI_YUKUMLULUKLERI) {
    const liste = satirlar.filter((s) => s.yukumluluk === y);
    if (!liste.length) continue;
    const aySonu = liste.filter((s) => {
      const hedef = new Date(Date.UTC(yil, s.ay - 1 + odemeAyFarki(y), 1));
      const sonGun = isGununeKaydir(`${hedef.getUTCFullYear()}-${iki(hedef.getUTCMonth() + 1)}-${iki(new Date(Date.UTC(hedef.getUTCFullYear(), hedef.getUTCMonth() + 1, 0)).getUTCDate())}`);
      return s.sonTarih === sonGun;
    }).length;
    if (aySonu * 2 > liste.length) { sonuc[y] = "ay_sonu"; continue; }
    const sayac = new Map<number, number>();
    for (const s of liste) { const g = Number(s.sonTarih.slice(8, 10)); sayac.set(g, (sayac.get(g) ?? 0) + 1); }
    sonuc[y] = [...sayac.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
  }
  return sonuc;
}

const ayEkle = (yil: number, ay: number, fark: number) => { const t = new Date(Date.UTC(yil, ay - 1 + fark, 1)); return { yil: t.getUTCFullYear(), ay: t.getUTCMonth() + 1 }; };
const EKSIK_TAKIP: readonly VergiYukumlulugu[] = ["kdv1", "kdv2", "muhtasar", "sgk"];

/** VTK-07: son tarihi önümüzdeki 3 ayda dolacak dönemler (geçen ay, bu ay, gelecek ay). */
function yaklasanDonemler(bugun: string) {
  const yil = Number(bugun.slice(0, 4)), ay = Number(bugun.slice(5, 7));
  return [-1, 0, 1].map((f) => ayEkle(yil, ay, f));
}

export function vergiTakvimBeklenenAnahtarlar(bugun: string): string[] {
  return yaklasanDonemler(bugun).flatMap((d) => EKSIK_TAKIP.map((y) => vergiTakvimAnahtari(y, d.yil, d.ay)));
}

/** Eksik dönem başına bir yayın takvimi satırı; platform kartı ve hatırlatma e-postası kullanır. */
export function vergiTakvimEksikleri(mevcutAnahtarlar: readonly string[], bugun: string): TakvimSatiri[] {
  const mevcut = new Set(mevcutAnahtarlar);
  return yaklasanDonemler(bugun).flatMap((d) => {
    const eksik = EKSIK_TAKIP.filter((y) => !mevcut.has(vergiTakvimAnahtari(y, d.yil, d.ay)));
    if (!eksik.length) return [];
    const donem = `${d.yil}-${iki(d.ay)}`;
    return [{
      tur: VERGI_TAKVIMI_TURU, anahtar: donem, ad: `Vergi ve SGK son tarihi (${eksik.map((y) => VERGI_YUKUMLULUK_ADLARI[y]).join(", ")})`,
      etki: "son tarih görünmez ve bildirim üretilmez", donem, baslangic: `${donem}-01`, kalanGun: 0, kayitVar: false, durum: "eksik" as const,
    }];
  });
}
