import * as bwipjs from "bwip-js";
import { kacis, paraBicim } from "../core/pdf/pdf-sablon";

/**
 * Barkod etiket basımı (STK-15 devamı, 4. aşama S-01). A4 sayfaya 3×8
 * etiket ızgarası (Avery L7160 uyumlu, 63,5×38,1 mm) basılır.
 */

export interface EtiketVerisi {
  urunAd: string;
  urunKod: string;
  barkod: string;
  /** Görüntülenecek satış fiyatı; yoksa fiyat satırı basılmaz. */
  satisFiyati: string | null;
}

/** 13 haneli ve sağlama hanesi doğruysa EAN-13, değilse Code 128. */
function barkodTuru(barkod: string): "ean13" | "code128" {
  if (!/^\d{13}$/.test(barkod)) return "code128";
  const haneler = barkod.split("").map(Number);
  const toplam = haneler
    .slice(0, 12)
    .reduce((t, h, i) => t + h * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (toplam % 10)) % 10 === haneler[12] ? "ean13" : "code128";
}

function barkodSvg(barkod: string): string {
  return bwipjs.toSVG({
    bcid: barkodTuru(barkod),
    text: barkod,
    height: 11,
    includetext: true,
    textsize: 8,
  });
}

export function etiketPdfHtml(etiketler: EtiketVerisi[]): string {
  const hucreler = etiketler
    .map(
      (e) => `<div class="etiket">
  <div class="ad">${kacis(e.urunAd)}</div>
  <div class="alt">
    <span class="kod">${kacis(e.urunKod)}</span>
    ${e.satisFiyati ? `<span class="fiyat">${paraBicim(e.satisFiyati)} TL</span>` : ""}
  </div>
  <div class="barkod">${barkodSvg(e.barkod)}</div>
</div>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "DejaVu Sans", Arial, sans-serif; }
  .izgara {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2mm;
  }
  .etiket {
    height: 36mm; padding: 2mm 3mm;
    border: 0.2mm dashed #d1d5db; border-radius: 1mm;
    overflow: hidden; page-break-inside: avoid;
    display: flex; flex-direction: column;
  }
  .ad {
    font-size: 8pt; font-weight: bold; line-height: 1.15;
    max-height: 8mm; overflow: hidden;
  }
  .alt {
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 7pt; color: #374151; margin: 1mm 0;
  }
  .fiyat { font-size: 9pt; font-weight: bold; color: #111827; }
  .barkod { flex: 1; display: flex; justify-content: center; }
  .barkod svg { max-width: 100%; height: 100%; }
</style>
</head>
<body>
  <div class="izgara">${hucreler}</div>
</body>
</html>`;
}
