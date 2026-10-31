/**
 * Takvim günü Türkiye'ye göre çözülür.
 *
 * `new Date().toISOString().slice(0, 10)` UTC gününü verir: Türkiye UTC+3
 * olduğu için gece yarısı ile 03:00 arasında **bir önceki günü** döndürür.
 * Sunucu tarafı 2026-09-20'den beri (EBLG-68) günü Türkiye takviminden
 * okuyor; ekranlar da aynı günü kullanmalı, yoksa gece çalışan kullanıcı
 * "bugün"ü dün olarak görüyor ve varsayılan tarihler geriye kayıyor.
 *
 * Türkiye 2016'dan beri kalıcı UTC+3, yaz saati uygulaması yok — gün ekleme
 * milisaniye aritmetiğiyle yapılabilir.
 */

const GUN_BICIMI = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" });

/**
 * PLT-29: `YYYY-MM-DD` gerçek bir takvim günü mü? Biçim denetimi yetmez:
 * V8 `new Date("2026-02-31")` değerini sessizce 3 Mart'a taşır. Gün UTC
 * gece yarısında kurulup geri yazılır; aynı metin dönmüyorsa gün yoktur.
 */
export function takvimGunuMu(deger: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deger) || deger.startsWith("0000")) return false;
  const an = new Date(`${deger}T00:00:00Z`);
  return Number.isFinite(an.getTime()) && an.toISOString().slice(0, 10) === deger;
}

const GUN_MS = 86_400_000;

/** Verilen anın Türkiye takvimindeki günü (`YYYY-MM-DD`). */
export function gunTR(an: Date = new Date()): string {
  return GUN_BICIMI.format(an);
}

/** Bugün, Türkiye takvimine göre (`YYYY-MM-DD`). */
export function bugunTR(): string {
  return gunTR();
}

/** Bugünden `gun` kadar ileri/geri gün (`YYYY-MM-DD`); eksi değer geriye gider. */
export function gunEkleTR(gun: number, an: Date = new Date()): string {
  return gunTR(new Date(an.getTime() + gun * GUN_MS));
}

/** İçinde bulunulan ay (`YYYY-MM`). */
export function ayTR(an: Date = new Date()): string {
  return gunTR(an).slice(0, 7);
}

/** İçinde bulunulan ayın ilk günü (`YYYY-MM-01`). */
export function ayBasiTR(an: Date = new Date()): string {
  return `${ayTR(an)}-01`;
}

/** İçinde bulunulan yılın ilk günü (`YYYY-01-01`). */
export function yilBasiTR(an: Date = new Date()): string {
  return `${gunTR(an).slice(0, 4)}-01-01`;
}

const TR_FARK_MS = 3 * 3_600_000;

/**
 * Anın Türkiye'deki tarih ve saati (`YYYY-MM-DD`, `HH:mm:ss`). UBL'e yazılan
 * sevk ve dönem saatleri alıcının göreceği yerel saattir; `toISOString()`
 * UTC yazar ve 09:30'da çıkan malı belgede 06:30'da çıkmış gösterirdi
 * (NES testi 2026-09-22).
 */
export function anTR(an: Date): { tarih: string; saat: string } {
  const metin = new Date(an.getTime() + TR_FARK_MS).toISOString();
  return { tarih: metin.slice(0, 10), saat: metin.slice(11, 19) };
}
