import * as bwipjs from "bwip-js";

/**
 * EBLG-32: GİB karekodu. İçerik `faturaKarekodVerisi`nden gelen JSON'dur;
 * burada yalnız QR'a çevrilir ve basılacak sayfaya yerleştirilir.
 */

/**
 * Karekodun basılı kenarı. İçerik KDV oranı başına uzar; iki oranlı faturada
 * (373 karakter) 30 mm karekod 100 dpi'lık taramada okunmadı, 35 mm okundu
 * (2026-09-13, WeChat QR okuyucusuyla ölçüldü).
 */
const KAREKOD_KENARI = "35mm";

/** Hata düzeltme seviyesi BWIPP'nin QR varsayılanı olan M'dir; kılavuz seviye belirtmez. */
export function karekodDataUri(veri: Record<string, string>): string {
  const svg = bwipjs.toSVG({ bcid: "qrcode", text: JSON.stringify(veri) });
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export function karekodImg(dataUri: string): string {
  return `<img src="${dataUri}" alt="GİB karekodu" style="width:${KAREKOD_KENARI};height:${KAREKOD_KENARI}"/>`;
}

/**
 * Belgenin kendi görünümüne karekodu ekler. Görünüm gönderilmiş belgenin
 * içindeki XSLT'den geldiği için şablona dokunulmaz; karekod sayfanın başına,
 * sağa yaslı bir blok olarak girer. Temizlemeden sonra çağrılır — karekod
 * yabancı içerik değil, bizim ürettiğimiz görseldir.
 */
export function karekoduHtmlEkle(html: string, dataUri: string): string {
  const blok = `<div style="text-align:right;margin:0 0 6px">${karekodImg(dataUri)}</div>`;
  const govde = /<body\b[^>]*>/i.exec(html);
  if (!govde) return blok + html;
  const son = govde.index + govde[0].length;
  return html.slice(0, son) + blok + html.slice(son);
}
