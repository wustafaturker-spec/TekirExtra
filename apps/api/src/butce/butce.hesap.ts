/**
 * Bütçe ile gerçekleşenin karşılaştırması (BUT-07) — saf hesap.
 *
 * Tutarlar kuruş cinsinden tamsayı taşınır. Gerçekleşen, gelir-gider
 * raporuyla aynı tahakkuk kalemlerinden gelir (rapor/tahakkuk.ts).
 */

export interface KalemTanimi {
  anahtar: string;
  tur: "gelir" | "gider";
  anaKategori: string;
  altKategori: string;
}

export interface GerceklesenKalem extends KalemTanimi {
  tarih: string;
  tutarTry: number;
}

export type SatirDurumu = "asim" | "eksik" | "uygun" | "plansiz";

export interface KarsilastirmaSatiri extends KalemTanimi {
  aylar: { ay: number; plan: number; ilkPlan: number; gerceklesen: number | null }[];
  toplam: {
    /** Yılın tamamının planı. */
    plan: number;
    ilkPlan: number;
    /** Karşılaştırmaya giren ayların planı (bu yıl için bugüne kadar). */
    planBugune: number;
    gerceklesen: number;
    fark: number;
    oran: number | null;
    durum: SatirDurumu;
  };
}

export const bosAylar = () => Array.from({ length: 12 }, () => 0);
const tl = (kurus: number) => kurus / 100;

/**
 * Yıllık tutarı 12 aya eşit dağıtır; kuruş farkı son aya eklenir (BUT-08).
 * Girdi ve çıktı kuruş.
 */
export function yillikDagit(yillikKurus: number): number[] {
  const aylik = Math.floor(yillikKurus / 12);
  const aylar = Array.from({ length: 12 }, () => aylik);
  aylar[11] += yillikKurus - aylik * 12;
  return aylar;
}

/**
 * Satırları ve toplamları üretir. `sonAy` karşılaştırılan son aydır: geçmiş
 * yılda 12, bu yıl içinde bulunulan ay, gelecek yılda 0. Daha sonraki ayların
 * gerçekleşeni boş (null) döner ve farka katılmaz — yoksa eylülde yıllık plan
 * dokuz aylık gerçekleşenle kıyaslanır.
 */
export function karsilastir(girdi: {
  tanimlar: KalemTanimi[];
  plan: Map<string, number[]>;
  ilkPlan: Map<string, number[]> | null;
  gerceklesen: GerceklesenKalem[];
  sonAy: number;
}) {
  const { sonAy } = girdi;
  const tanim = new Map(girdi.tanimlar.map((t) => [t.anahtar, t]));
  const gercek = new Map<string, number[]>();
  for (const k of girdi.gerceklesen) {
    if (!tanim.has(k.anahtar)) tanim.set(k.anahtar, { anahtar: k.anahtar, tur: k.tur, anaKategori: k.anaKategori, altKategori: k.altKategori });
    const aylar = gercek.get(k.anahtar) ?? bosAylar();
    aylar[Number(k.tarih.slice(5, 7)) - 1] += Math.round(k.tutarTry * 100);
    gercek.set(k.anahtar, aylar);
  }

  const anahtarlar = new Set([...girdi.plan.keys(), ...(girdi.ilkPlan?.keys() ?? []), ...gercek.keys()]);
  const sira = new Map(girdi.tanimlar.map((t, i) => [t.anahtar, i]));
  const satirlar: KarsilastirmaSatiri[] = [];
  for (const anahtar of anahtarlar) {
    const t = tanim.get(anahtar);
    if (!t) continue;
    const plan = girdi.plan.get(anahtar) ?? bosAylar();
    const ilk = girdi.ilkPlan?.get(anahtar) ?? bosAylar();
    const g = gercek.get(anahtar) ?? bosAylar();
    const planToplam = plan.reduce((a, b) => a + b, 0);
    const ilkToplam = ilk.reduce((a, b) => a + b, 0);
    const planBugune = plan.slice(0, sonAy).reduce((a, b) => a + b, 0);
    const gerceklesen = g.slice(0, sonAy).reduce((a, b) => a + b, 0);
    if (!planToplam && !ilkToplam && !gerceklesen) continue;
    const fark = gerceklesen - planBugune;
    const durum: SatirDurumu =
      planBugune === 0 ? (gerceklesen > 0 ? "plansiz" : "uygun")
      : t.tur === "gider" && fark > 0 ? "asim"
      : t.tur === "gelir" && fark < 0 ? "eksik"
      : "uygun";
    satirlar.push({
      ...t,
      aylar: plan.map((p, i) => ({ ay: i + 1, plan: tl(p), ilkPlan: tl(ilk[i]), gerceklesen: i < sonAy ? tl(g[i]) : null })),
      toplam: {
        plan: tl(planToplam),
        ilkPlan: tl(ilkToplam),
        planBugune: tl(planBugune),
        gerceklesen: tl(gerceklesen),
        fark: tl(fark),
        oran: planBugune > 0 ? Math.round((gerceklesen / planBugune) * 1000) / 10 : null,
        durum,
      },
    });
  }
  satirlar.sort((a, b) =>
    a.tur !== b.tur ? (a.tur === "gelir" ? -1 : 1) : (sira.get(a.anahtar) ?? 1e9) - (sira.get(b.anahtar) ?? 1e9) || a.anaKategori.localeCompare(b.anaKategori, "tr") || a.altKategori.localeCompare(b.altKategori, "tr"),
  );

  const topla = (tur: "gelir" | "gider") => {
    const s = satirlar.filter((x) => x.tur === tur);
    const k = (f: (x: KarsilastirmaSatiri) => number) => Math.round(s.reduce((t, x) => t + f(x) * 100, 0)) / 100;
    return { plan: k((x) => x.toplam.plan), ilkPlan: k((x) => x.toplam.ilkPlan), planBugune: k((x) => x.toplam.planBugune), gerceklesen: k((x) => x.toplam.gerceklesen) };
  };
  const gelir = topla("gelir");
  const gider = topla("gider");
  const fark = (a: number, b: number) => Math.round((a - b) * 100) / 100;
  return {
    satirlar,
    toplamlar: {
      gelir,
      gider,
      net: {
        plan: fark(gelir.plan, gider.plan),
        ilkPlan: fark(gelir.ilkPlan, gider.ilkPlan),
        planBugune: fark(gelir.planBugune, gider.planBugune),
        gerceklesen: fark(gelir.gerceklesen, gider.gerceklesen),
      },
    },
  };
}
