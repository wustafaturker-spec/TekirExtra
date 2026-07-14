/**
 * Ortak PDF şablon yardımcıları (T-02): TR sayı/tarih biçimleri, HTML kaçışı
 * ve tüm PDF çıktılarının paylaştığı sayfa iskeleti. Renk dili Excel
 * dışa aktarımıyla aynıdır (mor başlık, koyu lacivert tablo başlığı).
 */

const PARA = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const SAYI = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 });

export const paraBicim = (deger: string | number): string =>
  PARA.format(Number(deger));

export const sayiBicim = (deger: string | number): string =>
  SAYI.format(Number(deger));

export const tarihBicim = (deger: Date | string): string =>
  new Date(deger).toLocaleDateString("tr-TR");

export const kacis = (deger: unknown): string =>
  String(deger ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export interface SayfaSecenekleri {
  /** Belge başlığı (ör. "SATIŞ FATURASI", rapor adı). */
  baslik: string;
  /** Başlığın altındaki küçük satır (ör. firma ünvanı, filtre özeti). */
  altBaslik?: string;
  /** Gövde HTML'i. */
  icerik: string;
  /** KLN-03: firma logosu; yoksa üst şeritte TekirExtra markası kalır. */
  logoDataUri?: string;
}

/** Tüm PDF'lerin ortak iskeleti: üst şerit, içerik, tarihli alt bilgi. */
export function sayfaSablonu(s: SayfaSecenekleri): string {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "DejaVu Sans", Arial, sans-serif;
    font-size: 9.5pt; color: #111827;
  }
  .ust-serit {
    background: #6d28d9; color: #fff; padding: 10px 14px;
    border-radius: 4px; margin-bottom: 4px;
    display: flex; justify-content: space-between; align-items: baseline;
  }
  .ust-serit h1 { font-size: 13pt; letter-spacing: 0.5px; }
  .ust-serit .marka { font-size: 9pt; opacity: 0.85; }
  .ust-serit .logo { max-height: 28px; max-width: 120px; align-self: center; }
  .alt-baslik { color: #6b7280; font-size: 8.5pt; margin: 2px 2px 12px; }
  table.veri { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.veri th {
    background: #1e1b4b; color: #fff; text-align: left;
    padding: 5px 7px; font-size: 8.5pt;
  }
  table.veri td { padding: 4px 7px; border-bottom: 1px solid #e5e7eb; }
  table.veri tr:nth-child(even) td { background: #f9fafb; }
  .sag { text-align: right; }
  .orta { text-align: center; }
  .kutu {
    border: 1px solid #e5e7eb; border-radius: 4px; padding: 8px 10px;
  }
  .alt-bilgi {
    position: fixed; bottom: 0; left: 0; right: 0;
    color: #9ca3af; font-size: 7.5pt; display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="ust-serit">
    <h1>${kacis(s.baslik)}</h1>
    ${
      s.logoDataUri
        ? `<img class="logo" src="${kacis(s.logoDataUri)}" alt="">`
        : `<span class="marka">TekirExtra</span>`
    }
  </div>
  ${s.altBaslik ? `<div class="alt-baslik">${kacis(s.altBaslik)}</div>` : ""}
  ${s.icerik}
  <div class="alt-bilgi">
    <span>TekirExtra ile oluşturuldu</span>
    <span>${tarihBicim(new Date())}</span>
  </div>
</body>
</html>`;
}
