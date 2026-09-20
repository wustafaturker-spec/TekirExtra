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
