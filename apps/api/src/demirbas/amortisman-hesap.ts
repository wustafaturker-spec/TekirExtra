import { Prisma } from "@prisma/client";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const SIFIR = D(0);
const yuvarla = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export type AmortismanYontemi = "normal" | "azalan";

export interface PlanGirdisi {
  /** Amortismana esas bedel: edinme bedeli + ilave bedeller (TL). */
  bedel: Prisma.Decimal;
  edinmeTarihi: string; // YYYY-MM-DD
  faydaliOmur: number;
  yontem: AmortismanYontemi;
  normaleGecisYili?: number | null;
  /** DMR-05: binek otoda ilk yıl kıst, kalan kısım ömrü izleyen yıl. */
  binekOto: boolean;
  /** DMR-11: açılışta o güne kadar ayrılmış birikmiş ve son yılı. */
  acilis?: { birikmis: Prisma.Decimal; sonYil: number | null } | null;
  /** DMR-05: elden çıkış yılı ve sonrasında amortisman ayrılmaz. */
  cikisYili?: number | null;
  /** Kesinleşmiş yıllar: yıl → tutar. */
  kesinler?: Map<number, Prisma.Decimal>;
  /**
   * DMR-06: binek oto sınırı (TL). Bedel sınırı aşarsa her yılın tutarından
   * sınır/bedel oranını aşan kısım KKEG'dir. null = sınır yok.
   */
  binekSiniri?: number | null;
}

export interface PlanSatiri {
  yil: number;
  tutar: Prisma.Decimal;
  kkeg: Prisma.Decimal;
  birikmisOnce: Prisma.Decimal;
  birikmisSonra: Prisma.Decimal;
  /** kesin: kesinleşmiş; acilis: açılış birikmişine dahil (tutar toplu); plan: henüz kesinleşmemiş. */
  durum: "kesin" | "plan";
}

export interface Plan {
  satirlar: PlanSatiri[];
  /** Amortismanın ilk yılı (açılışta açılışın son yılını izleyen yıl). */
  ilkYil: number;
  /** Açılış birikmişi (yoksa 0). */
  acilisBirikmis: Prisma.Decimal;
}

/** DMR-04: azalan bakiyeler oranı normalin iki katı, en çok %50. */
export function azalanOran(omur: number): Prisma.Decimal {
  return Prisma.Decimal.min(D(2).div(omur), D("0.5"));
}

export function kkegHesapla(tutar: Prisma.Decimal, bedel: Prisma.Decimal, sinir: number | null | undefined): Prisma.Decimal {
  if (!sinir || bedel.lte(sinir) || tutar.isZero()) return SIFIR;
  return yuvarla(tutar.mul(D(1).sub(D(sinir).div(bedel))));
}

/**
 * Kartın yıl yıl amortisman planı (DMR-04/05/06/11). Kesinleşmiş yılların
 * tutarı kayıttan alınır; plan yılları kalan değerden hesaplanır, böylece
 * yuvarlama ve geçmiş farklar son yılda kapanır.
 */
export function amortismanPlani(g: PlanGirdisi): Plan {
  const edinmeYili = Number(g.edinmeTarihi.slice(0, 4));
  const edinmeAyi = Number(g.edinmeTarihi.slice(5, 7));
  const omur = g.faydaliOmur;
  const kist = g.binekOto && edinmeAyi > 1;
  // Ömrün son yılı (yıl numarası). Binek otoda kıst kalan kısım ömrü izleyen yılda.
  const sonYil = edinmeYili + omur - 1 + (kist ? 1 : 0);
  const acilisBirikmis = g.acilis?.birikmis ?? SIFIR;
  const ilkYil = g.acilis && g.acilis.sonYil != null ? g.acilis.sonYil + 1 : edinmeYili;
  const normalYillik = yuvarla(g.bedel.div(omur));

  const satirlar: PlanSatiri[] = [];
  let birikmis = acilisBirikmis;
  for (let yil = ilkYil; yil <= sonYil; yil++) {
    if (g.cikisYili != null && yil >= g.cikisYili) break;
    const kalan = g.bedel.sub(birikmis);
    if (kalan.lte(0)) break;
    const kesin = g.kesinler?.get(yil);
    let tutar: Prisma.Decimal;
    if (kesin) {
      tutar = kesin;
    } else if (yil === sonYil) {
      tutar = kalan;
    } else {
      const sira = yil - edinmeYili + 1; // 1 = edinme yılı
      const azalanDonemi = g.yontem === "azalan" && (g.normaleGecisYili == null || yil < g.normaleGecisYili);
      if (azalanDonemi) {
        tutar = yuvarla(kalan.mul(azalanOran(omur)));
      } else if (g.yontem === "azalan") {
        // Normale geçiş: kalan değer kalan yıllara eşit bölünür.
        tutar = yuvarla(kalan.div(sonYil - yil + 1));
      } else if (kist && sira === 1) {
        tutar = yuvarla(normalYillik.mul(13 - edinmeAyi).div(12));
      } else {
        tutar = normalYillik;
      }
      tutar = Prisma.Decimal.min(tutar, kalan);
    }
    const kkeg = kkegHesapla(tutar, g.bedel, g.binekSiniri);
    satirlar.push({ yil, tutar, kkeg, birikmisOnce: birikmis, birikmisSonra: birikmis.add(tutar), durum: kesin ? "kesin" : "plan" });
    birikmis = birikmis.add(tutar);
  }
  return { satirlar, ilkYil, acilisBirikmis };
}

/** Kartın verilen yıla kadar (o yıl dahil değil) kesinleşmemiş plan yılları. */
export function eksikOncekiYillar(plan: Plan, yil: number): number[] {
  return plan.satirlar.filter((s) => s.yil < yil && s.durum === "plan" && s.tutar.gt(0)).map((s) => s.yil);
}

/** DMR-07: ara dönem bilgi raporu — yıllık tutarın geçen çeyrek oranı. */
export function araDonemTutari(yillik: Prisma.Decimal, ceyrek: 1 | 2 | 3 | 4): Prisma.Decimal {
  return yuvarla(yillik.mul(ceyrek).div(4));
}

/** DMR-08: net defter değeri ve satış kârı/zararı (pozitif kâr). */
export function cikisSonucu(bedel: Prisma.Decimal, birikmis: Prisma.Decimal, satisBedeli: Prisma.Decimal) {
  const netDeger = bedel.sub(birikmis);
  return { netDeger, fark: satisBedeli.sub(netDeger) };
}
