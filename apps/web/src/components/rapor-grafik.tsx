"use client";

import { useEffect, useState } from "react";
import { grafikSvg, grafikVerisi, type GrafikTanimi } from "@tekirextra/shared";

/**
 * RPR-26: sonuç tablosunun üstündeki grafik. Çizim paylaşılan modülden
 * (PDF ile aynı); renkler etkin temanın token'larından okunur — SVG
 * öznitelikleri CSS değişkeni çözmediği için çizim anında.
 */
type Satir = Record<string, string | number | boolean | null>;

function temaRenkleri() {
  const s = getComputedStyle(document.documentElement);
  const v = (ad: string, yedek: string) => s.getPropertyValue(ad).trim() || yedek;
  return {
    renkler: [v("--seri-1", "#2a78d6"), v("--seri-2", "#eb6834"), v("--seri-3", "#1baf7a")] as [string, string, string],
    metin: v("--text", "#18202f"), soluk: v("--text-muted", "#667085"), izgara: v("--border", "#e6e9ee"), zemin: v("--surface", "#ffffff"),
  };
}

export function RaporGrafigi({ tanim, baslik, kolonlar, satirlar, kesik }: {
  tanim: GrafikTanimi;
  baslik: string;
  kolonlar: { alan: string; baslik: string; tip: string; dovizAlani?: string }[];
  satirlar: Satir[];
  /** Sonuç ekran sınırında kesildiyse grafik yalnız gelen satırlardandır. */
  kesik: boolean;
}) {
  const [svg, setSvg] = useState("");
  const [neden, setNeden] = useState("");
  useEffect(() => {
    const r = grafikVerisi(tanim, kolonlar, satirlar);
    if ("veri" in r) { setSvg(grafikSvg(r.veri, { ...temaRenkleri(), baslik })); setNeden(""); }
    else { setSvg(""); setNeden(r.neden); }
  }, [tanim, baslik, kolonlar, satirlar]);

  return (
    <details className="rapor-grafik" open>
      <summary>Grafik</summary>
      {svg
        // Çizim yalnız rapor verisinden üretilir; metinler grafikSvg içinde kaçışlanır.
        ? <div dangerouslySetInnerHTML={{ __html: svg }} />
        : <p className="rapor-grafik__not">{neden}</p>}
      {svg && kesik && <p className="rapor-grafik__not">Grafik ekrandaki ilk satırlardan çizildi; tamamı PDF'te.</p>}
    </details>
  );
}
