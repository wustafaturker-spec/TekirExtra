import { gunTR } from "@tekirextra/shared";

/** PLT-111/114/117: yedek planı, saklama ve alarm kuralları; veritabanına bakmaz. */
const SAAT_MS = 3_600_000;
const GUN_MS = 24 * SAAT_MS;
/** Türkiye yıl boyu UTC+3'tür. */
const TR_FARK_MS = 3 * SAAT_MS;

export const OTOMATIK_YEDEK_SAATI = 4;
export const GUNLUK_DENEME_SINIRI = 3;
export const YEDEK_ESIK = { yasSaat: 26, ajanDk: 10, uzunSaat: 6 };
const DENEME_SAATLERI = { bas: 5, son: 8 };
const ELLE_SAKLAMA_GUN = 90;
const GUNLUK = 7;
const HAFTALIK = 4;
const AYLIK = 12;

const trSaat = (t: Date) => new Date(t.getTime() + TR_FARK_MS).getUTCHours();

/** Otomatik yedeğin bu turda istenip istenmeyeceği; gün değilse istenecek İstanbul günü döner. */
export function otomatikYedekGunu(simdi: Date, kayitlar: { gun: Date | null; durum: string }[]): string | null {
  if (trSaat(simdi) < OTOMATIK_YEDEK_SAATI) return null;
  const gun = gunTR(simdi);
  const bugun = kayitlar.filter((k) => k.gun?.toISOString().slice(0, 10) === gun);
  if (bugun.some((k) => k.durum !== "hatali")) return null;
  return bugun.length >= GUNLUK_DENEME_SINIRI ? null : gun;
}

export function sonrakiOtomatikYedek(simdi: Date): Date {
  const tr = new Date(simdi.getTime() + TR_FARK_MS);
  const hedef = Date.UTC(tr.getUTCFullYear(), tr.getUTCMonth(), tr.getUTCDate(), OTOMATIK_YEDEK_SAATI) - TR_FARK_MS;
  return new Date(hedef > simdi.getTime() ? hedef : hedef + GUN_MS);
}

/** Aylık deneme sessiz saatte ve bu ay henüz deneme yapılmadıysa istenir. */
export function aylikDenemeGerekli(simdi: Date, sonDenemeAt: Date | null): boolean {
  const saat = trSaat(simdi);
  if (saat < DENEME_SAATLERI.bas || saat >= DENEME_SAATLERI.son) return false;
  return !sonDenemeAt || gunTR(sonDenemeAt).slice(0, 7) !== gunTR(simdi).slice(0, 7);
}

export interface SaklamaYedegi { id: string; tur: string; tarih: Date; korunuyor: boolean }

/** Bir haftanın anahtarı: İstanbul takvimiyle o haftanın pazartesisi. */
function haftaAnahtari(t: Date): string {
  const gun = new Date(`${gunTR(t)}T00:00:00Z`);
  return new Date(gun.getTime() - ((gun.getUTCDay() + 6) % 7) * GUN_MS).toISOString().slice(0, 10);
}

/** İlk `adet` farklı dönemin en yeni yedeğini tutar. */
function donemEnYenileri(sirali: SaklamaYedegi[], anahtar: (t: Date) => string, adet: number, tutulan: Set<string>) {
  const gorulen = new Set<string>();
  for (const y of sirali) {
    const a = anahtar(y.tarih);
    if (gorulen.has(a)) continue;
    if (gorulen.size >= adet) return;
    gorulen.add(a);
    tutulan.add(y.id);
  }
}

/**
 * PLT-114: silinecek yedekler. Dönemler, yedeği olan son N dönemdir; yedek
 * alınamayan haftalar yüzünden eski yedek erken silinmez. Dış kopya gelene dek
 * her yılın son otomatik yedeği sunucuda kalır.
 */
export function silinecekYedekler(yedekler: SaklamaYedegi[], simdi: Date): string[] {
  const sirali = [...yedekler].sort((a, b) => b.tarih.getTime() - a.tarih.getTime());
  const tutulan = new Set(sirali.slice(0, 1).map((y) => y.id));
  const otomatik = sirali.filter((y) => y.tur === "otomatik");
  donemEnYenileri(otomatik, (t) => gunTR(t), GUNLUK, tutulan);
  donemEnYenileri(otomatik, haftaAnahtari, HAFTALIK, tutulan);
  donemEnYenileri(otomatik, (t) => gunTR(t).slice(0, 7), AYLIK, tutulan);
  donemEnYenileri(otomatik, (t) => gunTR(t).slice(0, 4), Number.MAX_SAFE_INTEGER, tutulan);
  for (const y of sirali) {
    if (y.korunuyor || (y.tur === "elle" && simdi.getTime() - y.tarih.getTime() <= ELLE_SAKLAMA_GUN * GUN_MS)) tutulan.add(y.id);
  }
  return sirali.filter((y) => !tutulan.has(y.id)).map((y) => y.id);
}

export interface YedekDurumu {
  simdi: Date;
  ilkTalepAt: Date | null;
  sonBasariliAt: Date | null;
  sonBiten: { durum: string; hata: string | null } | null;
  aktif: { durum: string; baslangicAt: Date | null; talepAt: Date } | null;
  ajan: { sonNabizAt: Date; diskBosBayt: bigint } | null;
  sonBoyutBayt: bigint | null;
  sonDeneme: { durum: string; detay: string | null } | null;
}

export interface YedekSorunu { anahtar: string; tur: string; ozet: string }

/** PLT-117: sistem sağlığı alarmına giren yedek sorunları. Hiç talep yoksa servis henüz kurulmamıştır. */
export function yedekSorunlari(d: YedekDurumu): YedekSorunu[] {
  if (!d.ilkTalepAt) return [];
  const sorunlar: YedekSorunu[] = [];
  const t = d.simdi.getTime();
  const taban = d.sonBasariliAt ?? d.ilkTalepAt;
  if (t - taban.getTime() > YEDEK_ESIK.yasSaat * SAAT_MS) {
    sorunlar.push({ anahtar: "yedek-eski", tur: "yedek", ozet: d.sonBasariliAt ? `Son başarılı yedek ${Math.round((t - taban.getTime()) / SAAT_MS)} saat önce alındı` : "Henüz başarılı yedek alınamadı" });
  }
  if (d.sonBiten?.durum === "hatali") sorunlar.push({ anahtar: "yedek-hata", tur: "yedek", ozet: `Son yedek başarısız: ${(d.sonBiten.hata ?? "bilinmeyen hata").slice(0, 200)}` });
  const ajanYas = d.ajan ? t - d.ajan.sonNabizAt.getTime() : t - d.ilkTalepAt.getTime();
  if (ajanYas > YEDEK_ESIK.ajanDk * 60_000) sorunlar.push({ anahtar: "yedek-servis", tur: "yedek", ozet: "Yedek servisi yanıt vermiyor" });
  if (d.ajan && d.sonBoyutBayt !== null && d.ajan.diskBosBayt < d.sonBoyutBayt * 2n) sorunlar.push({ anahtar: "yedek-disk", tur: "yedek", ozet: "Yedek diskinde boş alan son yedeğin iki katından az" });
  if (d.aktif?.baslangicAt && t - d.aktif.baslangicAt.getTime() > YEDEK_ESIK.uzunSaat * SAAT_MS) sorunlar.push({ anahtar: "yedek-uzun", tur: "yedek", ozet: `Yedek ${YEDEK_ESIK.uzunSaat} saatten uzun sürüyor` });
  if (d.sonDeneme?.durum === "hatali") sorunlar.push({ anahtar: "yedek-deneme", tur: "yedek", ozet: `Geri yükleme denemesi başarısız: ${(d.sonDeneme.detay ?? "bilinmeyen hata").slice(0, 200)}` });
  return sorunlar;
}
