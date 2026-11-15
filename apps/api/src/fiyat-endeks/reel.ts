import { Prisma } from "@prisma/client";
import { aySonDegeri } from "./alacak-erimesi";

/**
 * END-18: reel gösterim. Tutar kendi ayının endeksinden baz aya taşınır:
 * reel = nominal × E(baz) / E(tutarın ayı). Baz, dönemin bitiş ayına kadar
 * son açıklanan aydır ("dönem sonu fiyatlarıyla"). Endeksi açıklanmamış ayda
 * o aydan önceki son açıklanan değer kullanılır. Yalnız gösterimdir.
 */
type D = Prisma.Decimal;

export interface ReelDegerleyici {
  bazAy: string;
  /** Tarihin ayına göre çarpan; endeks yoksa null. */
  carpan(tarih: Date | string): D | null;
}

const ayAnahtari = (t: Date | string) => (typeof t === "string" ? t.slice(0, 7) : t.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }).slice(0, 7)) + "-01";

export function reelDegerleyici(degerler: Map<string, D>, bitisAyi: string): ReelDegerleyici | null {
  const baz = aySonDegeri(degerler, bitisAyi);
  if (!baz) return null;
  return {
    bazAy: baz.ay,
    carpan(tarih) {
      const e = aySonDegeri(degerler, ayAnahtari(tarih));
      return e ? baz.deger.div(e.deger) : null;
    },
  };
}
