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
 * Gömülü XSLT'nin karekod için bıraktığı yer. Alıcının görüntüleyicisinde
 * XSLT'deki betik karekodu buraya çizer; bizim PDF'imizde betik çalışmadığı
 * için (EBLG-29) sunucu görseli buraya girer.
 */
export const KAREKOD_YER_TUTUCU_ID = "gib-karekod";

const YER_TUTUCU = new RegExp(`<div\\b[^>]*\\bid="${KAREKOD_YER_TUTUCU_ID}"[^>]*?(/?)>`, "i");

/**
 * Belgenin görünümüne karekodu ekler. Görünümde karekod yer tutucusu varsa
 * görsel oraya girer; yoksa (yer tutucudan önce kesilmiş belge, yedek
 * görünüm) sayfanın başına, sağa yaslı bir blok olarak eklenir. Temizlemeden
 * sonra çağrılır — karekod yabancı içerik değil, bizim ürettiğimiz görseldir.
 */
export function karekoduHtmlEkle(html: string, dataUri: string): string {
  const yer = YER_TUTUCU.exec(html);
  if (yer) {
    const son = yer.index + yer[0].length;
    // XMLSerializer boş div'i kendiliğinden kapanan etiket olarak yazabilir.
    const acilis = yer[1] ? `${yer[0].slice(0, -2)}>` : yer[0];
    return html.slice(0, yer.index) + acilis + karekodImg(dataUri) + (yer[1] ? "</div>" : "") + html.slice(son);
  }
  const blok = `<div style="text-align:right;margin:0 0 6px">${karekodImg(dataUri)}</div>`;
  const govde = /<body\b[^>]*>/i.exec(html);
  if (!govde) return blok + html;
  const son = govde.index + govde[0].length;
  return html.slice(0, son) + blok + html.slice(son);
}
