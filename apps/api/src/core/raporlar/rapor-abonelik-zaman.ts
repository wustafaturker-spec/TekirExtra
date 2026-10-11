/**
 * RPR-24: zamanlanmış rapor aboneliğinin zaman kuralları. Saat ve gün
 * Türkiye saatiyle yorumlanır; Türkiye 2016'dan beri yaz saati uygulamadan
 * sabit UTC+3'tür, bu yüzden sabit fark yeterlidir.
 */

export type Siklik = "gunluk" | "haftalik" | "aylik";
export type GoreliDonem = "dun" | "gecen_hafta" | "gecen_ay" | "bu_ay" | "bu_yil" | "gorunum";

export const SIKLIKLAR: readonly Siklik[] = ["gunluk", "haftalik", "aylik"];
export const DONEMLER: readonly GoreliDonem[] = ["dun", "gecen_hafta", "gecen_ay", "bu_ay", "bu_yil", "gorunum"];

const TR_FARK_MS = 3 * 60 * 60 * 1000;

/** Türkiye takvimindeki gün ve saat bileşenleri. */
function trParcalar(an: Date) {
  const t = new Date(an.getTime() + TR_FARK_MS);
  return { yil: t.getUTCFullYear(), ay: t.getUTCMonth(), gun: t.getUTCDate(), haftaGunu: ((t.getUTCDay() + 6) % 7) + 1 };
}

/** Türkiye'de verilen gün ve saatin UTC anı. */
const trAn = (yil: number, ay: number, gun: number, saat: string) => {
  const [s, d] = saat.split(":").map(Number);
  return new Date(Date.UTC(yil, ay, gun, s, d) - TR_FARK_MS);
};

/**
 * `simdi`den sonraki ilk gönderim anı. Haftalıkta `gun` 1 (Pazartesi)…7,
 * aylıkta 1…28 (her ayda bulunsun diye 28 ile sınırlı).
 */
export function sonrakiGonderim(a: { siklik: Siklik; gun: number | null; saat: string }, simdi: Date): Date {
  const p = trParcalar(simdi);
  for (let i = 0; i <= 62; i++) {
    const aday = trAn(p.yil, p.ay, p.gun + i, a.saat);
    if (aday <= simdi) continue;
    const ap = trParcalar(aday);
    if (a.siklik === "gunluk") return aday;
    if (a.siklik === "haftalik" && ap.haftaGunu === (a.gun ?? 1)) return aday;
    if (a.siklik === "aylik" && ap.gun === (a.gun ?? 1)) return aday;
  }
  throw new Error("Sonraki gönderim bulunamadı");
}

const iso = (yil: number, ay: number, gun: number) => new Date(Date.UTC(yil, ay, gun)).toISOString().slice(0, 10);

/** Göreli dönem → Türkiye takviminde başlangıç–bitiş (YYYY-AA-GG); "gorunum" null döner (sabit dönem korunur). */
export function donemCoz(donem: GoreliDonem, an: Date): { baslangic: string; bitis: string } | null {
  const { yil, ay, gun, haftaGunu } = trParcalar(an);
  switch (donem) {
    case "dun": return { baslangic: iso(yil, ay, gun - 1), bitis: iso(yil, ay, gun - 1) };
    case "gecen_hafta": return { baslangic: iso(yil, ay, gun - haftaGunu - 6), bitis: iso(yil, ay, gun - haftaGunu) };
    case "gecen_ay": return { baslangic: iso(yil, ay - 1, 1), bitis: iso(yil, ay, 0) };
    case "bu_ay": return { baslangic: iso(yil, ay, 1), bitis: iso(yil, ay, gun) };
    case "bu_yil": return { baslangic: iso(yil, 0, 1), bitis: iso(yil, ay, gun) };
    default: return null;
  }
}

/** Başarısız gönderimde yeniden deneme beklemesi: 15 dk, 1 sa, 4 sa; sonra sıradaki olağan zamana kalır. */
export function yenidenDenemeAni(deneme: number, simdi: Date): Date | null {
  const bekleme = [15, 60, 240][deneme - 1];
  return bekleme ? new Date(simdi.getTime() + bekleme * 60_000) : null;
}
