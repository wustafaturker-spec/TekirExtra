"use client";

/**
 * END-09/11: aylık seri çizgi grafiği. Değeri olmayan ay boş kalır, çizgi
 * orada kesilir (önceki ayın değeri taşınmaz). Eksen sıfırdan başlamaz;
 * endeks ölçeğinde (baz = 100) farklar okunur kalsın diye veri aralığına
 * oturur. Renkler tema token'larındandır; endeks çizgileri kesiklidir.
 */
export interface EndeksGrafikSerisi {
  ad: string;
  degerler: (number | null)[];
  /** 1–3: --seri-1…3 */
  renk: 1 | 2 | 3;
  kesikli?: boolean;
  /** END-07: liste fiyatı, maliyet gibi referans çizgileri noktalıdır. */
  noktali?: boolean;
}

const G = 760, H = 280, SOL = 56, SAG = 16, UST = 12, ALT = 34;
const sayi = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });

function olcek(min: number, max: number) {
  if (min === max) { min -= 1; max += 1; }
  const kaba = (max - min) / 4;
  const us = 10 ** Math.floor(Math.log10(kaba));
  const adim = [1, 2, 2.5, 5, 10].map((c) => c * us).find((a) => a >= kaba) ?? 10 * us;
  return { alt: Math.floor(min / adim) * adim, ust: Math.ceil(max / adim) * adim, adim };
}

export function EndeksGrafigi({ etiketler, seriler, baslik, birim }: { etiketler: string[]; seriler: EndeksGrafikSerisi[]; baslik: string; birim?: string }) {
  const tumu = seriler.flatMap((s) => s.degerler.filter((d): d is number => d !== null && Number.isFinite(d)));
  if (!tumu.length || !etiketler.length) return <p className="endeks-grafik__not">Grafik için değer yok.</p>;
  const o = olcek(Math.min(...tumu), Math.max(...tumu));
  const bant = (G - SOL - SAG) / etiketler.length;
  const x = (i: number) => SOL + bant * i + bant / 2;
  const y = (d: number) => UST + ((o.ust - d) / (o.ust - o.alt)) * (H - UST - ALT);
  const izgara: number[] = [];
  for (let d = o.alt; d <= o.ust + o.adim / 2; d += o.adim) izgara.push(Number(d.toFixed(10)));
  const etiketAdimi = Math.ceil(etiketler.length / 12);
  const deger = (d: number) => `${sayi.format(d)}${birim ? ` ${birim}` : ""}`;

  return (
    <figure className="endeks-grafik">
      <ul className="endeks-grafik__lejant" aria-hidden="true">
        {seriler.map((s) => (
          <li key={s.ad}><svg width="22" height="10"><line x1="1" x2="21" y1="5" y2="5" className={`endeks-grafik__cizgi seri-${s.renk}${s.kesikli ? " is-kesikli" : ""}${s.noktali ? " is-noktali" : ""}`} /></svg>{s.ad}</li>
        ))}
      </ul>
      <svg viewBox={`0 0 ${G} ${H}`} width="100%" role="img" aria-label={baslik}>
        {izgara.map((d) => (
          <g key={d}>
            <line x1={SOL} x2={G - SAG} y1={y(d)} y2={y(d)} className="endeks-grafik__izgara" />
            <text x={SOL - 8} y={y(d) + 4} textAnchor="end" className="endeks-grafik__eksen">{sayi.format(d)}</text>
          </g>
        ))}
        {etiketler.map((e, i) => (i % etiketAdimi ? null : <text key={e} x={x(i)} y={H - ALT + 18} textAnchor="middle" className="endeks-grafik__eksen">{e}</text>))}
        {seriler.map((s) => {
          // Boş aylar çizgiyi böler: her parça ayrı polyline.
          const parcalar: [number, number][][] = [];
          let parca: [number, number][] = [];
          s.degerler.forEach((d, i) => {
            if (d === null || !Number.isFinite(d)) { if (parca.length) parcalar.push(parca); parca = []; return; }
            parca.push([x(i), y(d)]);
          });
          if (parca.length) parcalar.push(parca);
          return (
            <g key={s.ad}>
              {parcalar.map((p, pi) => <polyline key={pi} points={p.map(([a, b]) => `${a},${b}`).join(" ")} className={`endeks-grafik__cizgi seri-${s.renk}${s.kesikli ? " is-kesikli" : ""}${s.noktali ? " is-noktali" : ""}`} />)}
              {s.degerler.map((d, i) => d === null ? null : (
                <circle key={i} cx={x(i)} cy={y(d)} r={3.5} className={`endeks-grafik__nokta seri-${s.renk}`}>
                  <title>{`${etiketler[i]} · ${s.ad}: ${deger(d)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <figcaption className="endeks-grafik__not">Boş aylarda çizgi kesilir; o ayda fatura ya da açıklanmış değer yoktur.</figcaption>
    </figure>
  );
}
