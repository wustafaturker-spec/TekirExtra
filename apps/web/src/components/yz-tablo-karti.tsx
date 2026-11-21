"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { TableWrap } from "@/components/ui";
import { sayiMetni } from "./yz-tablo-bicim";

/**
 * AI-117: asistan yanıtında tablo ve grafik kartı. Veri araç çıktısından gelir
 * (model yazmaz); burada yalnız biçimlenir. Sıralama istemcidedir, grafik
 * küçük bir SVG'dir ve renkleri tema token'larından (--seri-1/2) alır.
 */
export type TabloKolonTipi = "metin" | "sayi" | "para" | "yuzde" | "tarih";
export interface TabloKolonu { alan: string; baslik: string; tip: TabloKolonTipi; paraBirimi?: string; dovizAlani?: string }
export interface TabloKarti {
  arac: string;
  baslik: string;
  adres: string;
  kolonlar: TabloKolonu[];
  satirlar: Array<Record<string, string | null>>;
  satirSayisi: number;
  grafik?: { tur: "cubuk" | "cizgi"; etiketAlani: string; seriler: Array<{ alan: string; baslik: string }>; paraBirimi?: string };
  uyarilar: string[];
}

const SAYISAL = new Set<TabloKolonTipi>(["sayi", "para", "yuzde"]);

function hucreMetni(k: TabloKolonu, satir: Record<string, string | null>): string {
  const d = satir[k.alan];
  if (d === null || d === undefined || d === "") return "—";
  if (k.tip === "para") {
    const birim = k.paraBirimi ?? (k.dovizAlani ? satir[k.dovizAlani] : null);
    return `${sayiMetni(d, true)}${birim ? ` ${birim}` : ""}`;
  }
  if (k.tip === "sayi") return sayiMetni(d);
  if (k.tip === "yuzde") return `%${sayiMetni(d)}`;
  if (k.tip === "tarih" && /^\d{4}-\d{2}-\d{2}/.test(d)) return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
  return d;
}

const sayiDegeri = (d: string | null | undefined) => (d === null || d === undefined || d === "" ? null : Number(d));

function karsilastir(k: TabloKolonu, a: Record<string, string | null>, b: Record<string, string | null>) {
  if (SAYISAL.has(k.tip)) {
    const x = sayiDegeri(a[k.alan]), y = sayiDegeri(b[k.alan]);
    if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
    return x - y;
  }
  return (a[k.alan] ?? "").localeCompare(b[k.alan] ?? "", "tr");
}

const G = 360, SATIR_Y = 22, ETIKET_G = 120;

function CubukGrafik({ kart }: { kart: TabloKarti }) {
  const g = kart.grafik!;
  const satirlar = kart.satirlar.slice(0, 12);
  const degerler = satirlar.flatMap((s) => g.seriler.map((x) => sayiDegeri(s[x.alan]) ?? 0));
  const enBuyuk = Math.max(0, ...degerler), enKucuk = Math.min(0, ...degerler);
  const aralik = enBuyuk - enKucuk || 1;
  const cizim = G - ETIKET_G - 8;
  const x = (d: number) => ETIKET_G + ((d - enKucuk) / aralik) * cizim;
  const bant = SATIR_Y * g.seriler.length + 8;
  const H = satirlar.length * bant + 4;
  return (
    <svg viewBox={`0 0 ${G} ${H}`} width="100%" role="img" aria-label={`${kart.baslik} grafiği`} className="yz-tablo__grafik">
      <line x1={x(0)} x2={x(0)} y1={0} y2={H} className="yz-tablo__eksen" />
      {satirlar.map((s, i) => {
        const etiket = s[g.etiketAlani] ?? "";
        return (
          <g key={i} transform={`translate(0 ${i * bant + 4})`}>
            <text x={ETIKET_G - 6} y={(bant - 8) / 2 + 4} textAnchor="end" className="yz-tablo__etiket">{etiket.length > 18 ? `${etiket.slice(0, 17)}…` : etiket}<title>{etiket}</title></text>
            {g.seriler.map((seri, j) => {
              const d = sayiDegeri(s[seri.alan]) ?? 0;
              const bas = Math.min(x(0), x(d)), gen = Math.max(1, Math.abs(x(d) - x(0)));
              return (
                <rect key={seri.alan} x={bas} y={j * SATIR_Y} width={gen} height={SATIR_Y - 6} rx={3} className={`yz-tablo__cubuk seri-${j + 1}`}>
                  <title>{`${etiket} · ${seri.baslik}: ${sayiMetni(s[seri.alan] ?? "0", !!g.paraBirimi)}${g.paraBirimi ? ` ${g.paraBirimi}` : ""}`}</title>
                </rect>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function CizgiGrafik({ kart }: { kart: TabloKarti }) {
  const g = kart.grafik!;
  const satirlar = [...kart.satirlar].sort((a, b) => (a[g.etiketAlani] ?? "").localeCompare(b[g.etiketAlani] ?? ""));
  const H = 150, SOL = 8, SAG = 8, UST = 10, ALT = 22;
  const degerler = satirlar.flatMap((s) => g.seriler.map((x) => sayiDegeri(s[x.alan])).filter((d): d is number => d !== null));
  if (!degerler.length) return null;
  let enKucuk = Math.min(...degerler), enBuyuk = Math.max(...degerler);
  if (enKucuk === enBuyuk) { enKucuk -= 1; enBuyuk += 1; }
  const x = (i: number) => SOL + (satirlar.length === 1 ? 0 : (i / (satirlar.length - 1)) * (G - SOL - SAG));
  const y = (d: number) => UST + ((enBuyuk - d) / (enBuyuk - enKucuk)) * (H - UST - ALT);
  const tarih = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : d ?? "");
  return (
    <svg viewBox={`0 0 ${G} ${H}`} width="100%" role="img" aria-label={`${kart.baslik} grafiği`} className="yz-tablo__grafik">
      <line x1={SOL} x2={G - SAG} y1={H - ALT} y2={H - ALT} className="yz-tablo__eksen" />
      <text x={SOL} y={H - 6} className="yz-tablo__etiket">{tarih(satirlar[0][g.etiketAlani])}</text>
      <text x={G - SAG} y={H - 6} textAnchor="end" className="yz-tablo__etiket">{tarih(satirlar[satirlar.length - 1][g.etiketAlani])}</text>
      {g.seriler.map((seri, j) => {
        const noktalar = satirlar.map((s, i) => [i, sayiDegeri(s[seri.alan])] as const).filter((n): n is readonly [number, number] => n[1] !== null);
        return (
          <g key={seri.alan}>
            <polyline points={noktalar.map(([i, d]) => `${x(i)},${y(d)}`).join(" ")} className={`yz-tablo__cizgi seri-${j + 1}`} />
            {noktalar.map(([i, d]) => (
              <circle key={i} cx={x(i)} cy={y(d)} r={3} className={`yz-tablo__nokta seri-${j + 1}`}>
                <title>{`${tarih(satirlar[i][g.etiketAlani])} · ${seri.baslik}: ${sayiMetni(satirlar[i][seri.alan] ?? "0", !!g.paraBirimi)}${g.paraBirimi ? ` ${g.paraBirimi}` : ""}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function Kart({ kart }: { kart: TabloKarti }) {
  const [sira, setSira] = useState<{ alan: string; artan: boolean } | null>(null);
  const satirlar = useMemo(() => {
    const k = sira && kart.kolonlar.find((c) => c.alan === sira.alan);
    if (!k) return kart.satirlar;
    return [...kart.satirlar].sort((a, b) => (sira.artan ? 1 : -1) * karsilastir(k, a, b));
  }, [kart, sira]);
  const sirala = (alan: string) => setSira((s) => (s?.alan === alan ? (s.artan ? { alan, artan: false } : null) : { alan, artan: true }));
  const eksik = kart.satirSayisi > kart.satirlar.length;
  return (
    <section className="yz-tablo" aria-label={kart.baslik}>
      <header className="yz-tablo__baslik">
        <strong>{kart.baslik}</strong>
        <Link href={kart.adres} className="btn-link">{eksik ? "Tamamını rapor ekranında aç" : "Ekranda aç"} <ExternalLink size={12} aria-hidden="true" /></Link>
      </header>
      {kart.grafik && (
        <figure className="yz-tablo__sekil">
          {kart.grafik.seriler.length > 1 && (
            <ul className="yz-tablo__lejant" aria-hidden="true">
              {kart.grafik.seriler.map((s, j) => <li key={s.alan}><span className={`yz-tablo__renk seri-${j + 1}`} />{s.baslik}</li>)}
            </ul>
          )}
          {kart.grafik.tur === "cizgi" ? <CizgiGrafik kart={kart} /> : <CubukGrafik kart={kart} />}
        </figure>
      )}
      <TableWrap className="yz-tablo__kaydir">
        <table className="table yz-tablo__tablo">
          <thead>
            <tr>
              {kart.kolonlar.map((k) => {
                const aktif = sira?.alan === k.alan;
                return (
                  <th key={k.alan} className={SAYISAL.has(k.tip) ? "is-sayi" : undefined} aria-sort={aktif ? (sira!.artan ? "ascending" : "descending") : "none"}>
                    <button type="button" onClick={() => sirala(k.alan)} title="Sırala">
                      {k.baslik}{aktif && (sira!.artan ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />)}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {satirlar.map((s, i) => (
              <tr key={i}>{kart.kolonlar.map((k) => <td key={k.alan} className={SAYISAL.has(k.tip) ? "is-sayi" : undefined}>{hucreMetni(k, s)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {eksik && <p className="yz-tablo__not">İlk {kart.satirlar.length} satır gösterildi (toplam {sayiMetni(String(kart.satirSayisi))}); tamamı rapor ekranında.</p>}
      {kart.uyarilar.map((u, i) => <p key={i} className="yz-tablo__not">{u}</p>)}
    </section>
  );
}

export function YzTabloKartlari({ kartlar = [] }: { kartlar?: TabloKarti[] }) {
  if (!kartlar.length) return null;
  return <div className="yz-tablolar">{kartlar.map((k, i) => <Kart key={`${k.arac}-${i}`} kart={k} />)}</div>;
}
